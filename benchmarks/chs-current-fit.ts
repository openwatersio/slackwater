// Fits the curated CHS current gates with `chsCurrentFit` from CHS's own
// `wcsp1`/`wcdp1` predictions, at every window the recipe allows, and scores
// held-out weeks against CHS's published `wcp1-events`, using the bar in
// docs/validation/chs-currents.md. The fit ends at the start of the current
// UTC month, so each monthly run measures a different season.
import { expect } from "vitest";
import { mkdir, readFile, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { join } from "path";
import { stations } from "@slackwater/database";
import {
  chsCurrentFit,
  createCurrentPredictor,
  fit,
  projectChsCurrent,
  type CurrentEventKind,
  type HarmonicSample,
} from "@slackwater/engine";

const __dirname = new URL(".", import.meta.url).pathname;
const IWLS = "https://api-iwls.dfo-mpo.gc.ca/api/v1";
const DAY = 86_400_000;
const STEP = chsCurrentFit.sampleMinutes * 60_000;

const FAST = !!process.env.FAST;
// A fitted model never expires on device, so one held-out week understates
// how far it drifts.
const HOLDOUT_DAYS = FAST ? [28] : [28, 90, 180, 270];
const GATE_LIMIT = FAST ? 3 : Infinity;

// The bar, set before scoring. Slack is the quantity a skipper acts on, since
// a gate is transited at slack, so it carries the tightest numbers.
const SLACK_MEDIAN_MAX_MIN = 15;
const SLACK_WORST_MAX_MIN = 30;
const EXTREMA_MEDIAN_MAX_MIN = 20;
const SPEED_MEDIAN_MAX_KN = 0.5;
// Observed extrema weaker than this are left out of timing and speed scoring:
// the peak of a 0.3 kn drift is noise.
const SIGNIFICANT_KN = 0.75;
// Same-kind events farther apart than this are different cycles.
const MATCH_WINDOW_MIN = 180;
// A model with the wrong sign at this share of CHS's extrema has its flood
// axis reversed.
const REVERSED_SHARE = 0.6;
// Gates are matched to IWLS stations by position, never by name.
const RESOLVE_KM = 3;
// Curated gates with no current station of their own: Malibu Rapids' slack
// derives from a tide port. Every other gate counts toward the share floors
// below, scored or not.
const NOT_FITTED = new Set(["chs-malibu-rapids"]);

await mkdir(".test-cache", { recursive: true });

// FIT_END=YYYY-MM-DD reproduces a recorded run; the fit ends at 00:00 UTC
// that day.
const now = new Date();
const fitEnd = process.env.FIT_END
  ? Date.parse(`${process.env.FIT_END}T00:00:00Z`)
  : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
if (Number.isNaN(fitEnd)) throw new Error(`FIT_END is not a date: ${process.env.FIT_END}`);
const longest = Math.max(...chsCurrentFit.days);
const stamp = new Date(fitEnd).toISOString().slice(0, 10);

interface IwlsStation {
  id: string;
  code: string;
  officialName: string;
  latitude: number;
  longitude: number;
  timeSeries: { code: string }[];
}

const all: IwlsStation[] = await fetchIwls("stations", "stations");
const currentStations = all.filter((s) =>
  s.timeSeries.some((t) => t.code === chsCurrentFit.speedSeries),
);
const gates = stations
  .filter((s) => s.kind === "current" && s.source.name === "Canadian Hydrographic Service")
  .sort((a, b) => a.id.localeCompare(b.id))
  .slice(0, GATE_LIMIT);

console.log(
  `Fitting ${gates.length} CHS current gates at ${chsCurrentFit.days.join(" and ")} d ending ${stamp}, ` +
    `held out at +${HOLDOUT_DAYS.join(", +")} d`,
);

interface Stat {
  gate: string;
  iwls: string;
  fit_days: number;
  holdout_days: number;
  fit_rms_kn: number;
  slack_median_min: number;
  slack_worst_min: number;
  slack_matched: number;
  slacks: number;
  extrema_median_min: number;
  extrema_scored: number;
  speed_median_kn: number;
  wrong_sign: number;
  extrema: number;
  reversed: boolean;
  pass: boolean;
}

const stats: Stat[] = [];
const skipped: string[] = [];

for (const gate of gates) {
  const station = nearest(gate.latitude, gate.longitude);
  if (!station) {
    skipped.push(`${gate.id} (no ${chsCurrentFit.speedSeries} within ${RESOLVE_KM} km)`);
    continue;
  }
  const meta: { floodDirection?: number; ebbDirection?: number } = await fetchIwls(
    `stations/${station.id}/metadata`,
    `${station.code}-metadata`,
  );
  if (meta.floodDirection == null || meta.ebbDirection == null) {
    skipped.push(`${gate.id} (no flood axis)`);
    continue;
  }
  const { floodDirection, ebbDirection } = meta;

  const from = fitEnd - longest * DAY;
  const speeds = await series(station, chsCurrentFit.speedSeries, from, fitEnd);
  const directions = await series(station, chsCurrentFit.directionSeries, from, fitEnd);
  const projected = projectChsCurrent(speeds, directions, floodDirection);

  for (const days of chsCurrentFit.days) {
    // Every shorter window is the trailing slice of the longest one, as the
    // apps fetch it.
    const samples = projected.filter((s) => s.time.getTime() >= fitEnd - days * DAY);
    if (samples.length < 1 + 2 * chsCurrentFit.basis.length) {
      skipped.push(`${gate.id}@${days}d`);
      continue;
    }
    const result = fit(samples, chsCurrentFit.basis);
    const predictor = createCurrentPredictor(result.constituents, {
      floodDirection,
      ebbDirection,
      meanFlow: result.offset,
    });

    for (const holdout of HOLDOUT_DAYS) {
      const start = fitEnd + holdout * DAY;
      const end = start + 7 * DAY;
      const observed = await events(station, start, end);
      if (observed.length === 0) {
        skipped.push(`${gate.id}@${days}d+${holdout}`);
        continue;
      }
      const predicted = predictor.getEventsPrediction({
        start: new Date(start - DAY / 2),
        end: new Date(end + DAY / 2),
      });

      const slackErrors: number[] = [];
      const extremaErrors: number[] = [];
      const speedErrors: number[] = [];
      let slacks = 0;
      let extrema = 0;
      let wrongSign = 0;
      for (const obs of observed) {
        if (obs.kind === "slack") {
          slacks++;
          const dt = Math.min(
            ...predicted.filter((p) => p.kind === "slack").map((p) => minutes(p.time, obs.time)),
          );
          if (dt <= MATCH_WINDOW_MIN) slackErrors.push(dt);
          continue;
        }
        extrema++;
        // The sign of the modelled velocity at CHS's own extremum is the test
        // for a reversed axis; a matched event's sign would only say which
        // event matched.
        const [{ speed }] = predictor.getTimelinePrediction({
          start: obs.time,
          end: new Date(obs.time.getTime() + 60_000),
          timeFidelity: 60,
        });
        if ((obs.kind === "maxFlood" && speed < 0) || (obs.kind === "maxEbb" && speed > 0))
          wrongSign++;
        if (Math.abs(obs.speed) < SIGNIFICANT_KN) continue;
        let best: { dt: number; speed: number } | undefined;
        for (const p of predicted) {
          if (p.kind !== obs.kind) continue;
          const dt = minutes(p.time, obs.time);
          if (!best || dt < best.dt) best = { dt, speed: p.speed };
        }
        if (best && best.dt <= MATCH_WINDOW_MIN) {
          extremaErrors.push(best.dt);
          speedErrors.push(Math.abs(best.speed - obs.speed));
        }
      }

      const slackMedian = median(slackErrors);
      const slackWorst = slackErrors.length ? Math.max(...slackErrors) : NaN;
      const extremaMedian = median(extremaErrors);
      const speedMedian = median(speedErrors);
      const reversed = extrema > 0 && wrongSign / extrema >= REVERSED_SHARE;
      stats.push({
        gate: gate.id,
        iwls: station.code,
        fit_days: days,
        holdout_days: holdout,
        fit_rms_kn: result.rms,
        slack_median_min: slackMedian,
        slack_worst_min: slackWorst,
        slack_matched: slackErrors.length,
        slacks,
        extrema_median_min: extremaMedian,
        extrema_scored: extremaErrors.length,
        speed_median_kn: speedMedian,
        wrong_sign: wrongSign,
        extrema,
        reversed,
        // An empty set of errors leaves NaN, which fails every comparison.
        pass:
          slackErrors.length === slacks &&
          !reversed &&
          slackMedian <= SLACK_MEDIAN_MAX_MIN &&
          slackWorst <= SLACK_WORST_MAX_MIN &&
          extremaMedian <= EXTREMA_MEDIAN_MAX_MIN &&
          speedMedian <= SPEED_MEDIAN_MAX_KN,
      });
    }
  }
  process.stdout.write(".");
}

console.log(`\nSkipped: ${skipped.length ? skipped.join(", ") : "none"}`);

const columns = Object.keys(stats[0] ?? {}) as (keyof Stat)[];
const csv = createWriteStream(join(__dirname, "chs-current-fit.csv"));
csv.write(columns.join(",") + "\n");
for (const s of stats) {
  csv.write(
    columns
      .map((c) => {
        const v = s[c];
        if (typeof v !== "number") return JSON.stringify(v);
        return Number.isInteger(v) ? String(v) : v.toFixed(2);
      })
      .join(",") + "\n",
  );
}
csv.end();

// What each gate's first held-out week supports: the shortest window that
// passes, and for a longer one, the provisional slack bound its 60-day fit
// earns, rounded up to 5 minutes. A 60-day fit that missed a slack has no
// bound. One week of one run is a reading, not a curated value.
const [shortest] = chsCurrentFit.days;
const first = HOLDOUT_DAYS[0];
const dispositions = Object.fromEntries(
  gates.flatMap((gate) => {
    const rows = stats.filter((s) => s.gate === gate.id && s.holdout_days === first);
    if (rows.length === 0) return [];
    const passing = chsCurrentFit.days.find((d) => rows.find((s) => s.fit_days === d)?.pass);
    if (passing === undefined) return [[gate.id, "fails"]];
    if (passing === shortest) return [[gate.id, `${passing} d`]];
    const short = rows.find((s) => s.fit_days === shortest);
    const worst = short && short.slack_matched === short.slacks ? short.slack_worst_min : NaN;
    const bound = Math.ceil(worst / 5) * 5;
    const provisional =
      Number.isFinite(bound) && bound <= chsCurrentFit.provisionalSlackMaxMinutes
        ? `provisional ±${bound} min`
        : "no provisional";
    return [[gate.id, `${passing} d, ${provisional}`]];
  }),
);
console.log(`At +${first} d, this run alone:`, dispositions);

const resolved = new Map(stats.map((s) => [s.gate, s.iwls]));
const codes = [...resolved.values()];
const shared = [...resolved]
  .filter(([, code]) => codes.indexOf(code) !== codes.lastIndexOf(code))
  .map(([gate]) => gate);
expect(shared, "gates resolved to the same IWLS station").toEqual([]);

// Shares are of every gate that should be scored, so a gate IWLS stops
// serving counts against the floor rather than leaving it to the gates that
// remain.
const expected = gates.filter((gate) => !NOT_FITTED.has(gate.id)).length;

for (const holdout of HOLDOUT_DAYS) {
  for (const days of chsCurrentFit.days) {
    const rows = stats.filter((s) => s.holdout_days === holdout && s.fit_days === days);
    const passing = rows.filter((s) => s.pass).length;
    const slack = rows
      .map((s) => s.slack_median_min)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const p50 = ntile(slack, 0.5);
    console.log(`${days} d fit, +${holdout} d:`, {
      count: rows.length,
      expected,
      passing,
      p50SlackMedianMin: p50,
    });

    expect(rows.length, `${days} d +${holdout} d gates scored`).toBeGreaterThan(0);
    expect(
      rows.filter((s) => s.reversed).map((s) => s.gate),
      `${days} d +${holdout} d reversed axes`,
    ).toEqual([]);
    // Baseline expectations from the run with the fit ending 2026-10-01 in
    // docs/validation/chs-currents.md, below its worst held-out week (3 of 23
    // at 60 d, 10 of 23 at 210 d) by at least one gate. Verdicts near the bar
    // move with the season; move these toward it as the recipe improves.
    const baseline = days === shortest ? { share: 0.05, p50: 20 } : { share: 0.3, p50: 15 };
    expect(passing / expected, `${days} d +${holdout} d share passing`).toBeGreaterThanOrEqual(
      baseline.share,
    );
    expect(p50, `${days} d +${holdout} d slack median p50`).toBeLessThan(baseline.p50);
  }
}

interface Event {
  time: Date;
  kind: CurrentEventKind;
  /** Signed knots, positive on the flood. */
  speed: number;
}

function nearest(latitude: number, longitude: number) {
  let best: { station: IwlsStation; km: number } | undefined;
  for (const station of currentStations) {
    const distance = km(latitude, longitude, station.latitude, station.longitude);
    if (!best || distance < best.km) best = { station, km: distance };
  }
  return best && best.km <= RESOLVE_KM ? best.station : undefined;
}

async function events(station: IwlsStation, from: number, to: number) {
  const query = new URLSearchParams({
    "time-series-code": "wcp1-events",
    from: iso(from),
    to: iso(to),
  });
  const rows: { eventDate: string; qualifier: string; value: number }[] = await fetchIwls(
    `stations/${station.id}/data?${query}`,
    `${station.code}-wcp1-events-${iso(from).slice(0, 10)}`,
  );
  return rows.flatMap((row): Event[] => {
    const time = new Date(row.eventDate);
    if (row.qualifier === "SLACK") return [{ time, kind: "slack", speed: 0 }];
    if (row.qualifier === "EXTREMA_FLOOD") return [{ time, kind: "maxFlood", speed: row.value }];
    if (row.qualifier === "EXTREMA_EBB") return [{ time, kind: "maxEbb", speed: -row.value }];
    return [];
  });
}

async function series(station: IwlsStation, code: string, from: number, to: number) {
  const out: HarmonicSample[] = [];
  for (let t = from; t < to; t += 7 * DAY) {
    const query = new URLSearchParams({
      "time-series-code": code,
      from: iso(t),
      to: iso(Math.min(t + 7 * DAY, to)),
      resolution: "FIFTEEN_MINUTES",
    });
    const rows: { eventDate: string; value: number }[] = await fetchIwls(
      `stations/${station.id}/data?${query}`,
      `${station.code}-${code}-${iso(t).slice(0, 10)}`,
    );
    for (const row of rows) {
      const time = new Date(row.eventDate);
      if (typeof row.value !== "number" || time.getTime() % STEP !== 0) continue;
      if (out.at(-1)?.time.getTime() === time.getTime()) continue;
      out.push({ time, value: row.value });
    }
  }
  return out;
}

async function fetchIwls(path: string, cacheKey: string) {
  const filePath = `./.test-cache/chs-current-fit-${cacheKey}.json`;
  try {
    return await readFile(filePath, "utf-8").then((data) => JSON.parse(data));
  } catch {
    const res = await fetchWithBackoff(`${IWLS}/${path}`);
    const data = await res.json();
    await writeFile(filePath, JSON.stringify(data));
    return data;
  }
}

// IWLS rate-limits long runs partway through; back off and carry on rather
// than lose the run. Requests are spaced like the apps space theirs.
async function fetchWithBackoff(url: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    await sleep(1000);
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) throw new Error(`IWLS ${res.status} for ${url}`);
    await sleep(5000 * 2 ** attempt);
  }
  throw new Error(`IWLS still failing after 6 attempts for ${url}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iso(ms: number) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function minutes(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const d = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * d) / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function median(data: number[]) {
  if (data.length === 0) return NaN;
  const s = [...data].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ntile(data: number[], percent: number) {
  return data[Math.floor(data.length * percent)] ?? NaN;
}
