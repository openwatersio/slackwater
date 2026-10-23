// Fits CHS tide ports with `chsTideFit` from CHS's own `wlp` predictions and
// scores held-out weeks against them, using the bar in
// docs/validation/chs-tides.md. The fit inputs follow the IWLS fetching
// contract (docs/iwls-fetch.md), so they are the samples a phone fits from:
// the window ends at the port's local midnight on the 1st of the current
// month, and so each monthly run measures a different season.
import { expect } from "vitest";
import { mkdir, readFile, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { join } from "path";
import { chsTideFit, createTidePredictor, fit } from "@slackwater/engine";
import {
  BASE,
  IwlsError,
  chunkPlan,
  createClient,
  decode,
  isTransient,
  localMidnight,
  parseEventDate,
  pathComponent,
  type Chunk,
  type IwlsStation,
  type Sample,
} from "./iwls.ts";

const __dirname = new URL(".", import.meta.url).pathname;
const DAY = 86_400_000;
const iwls = createClient();

const FAST = !!process.env.FAST;
// A model never expires on device, and its error follows the seasonal mean
// level, so one held-out week understates it.
const HOLDOUT_DAYS = FAST ? [28] : [28, 90, 180, 270];
const SAMPLE_SIZE = FAST ? 3 : 64;

// The bar, set before scoring. Height clauses take the looser of an absolute
// and a relative limit, because 10 cm is a fifth of a small port's range and a
// rounding error at Saint John.
const HEIGHT_ABS_CM = 10;
const HEIGHT_REL = 0.02;
const TIMING_MEDIAN_MAX_MIN = 20;
const TIMING_WORST_MAX_MIN = 40;
const MATCH_WINDOW_MIN = 180;

await mkdir(".test-cache", { recursive: true });

// Midday UTC on the 1st is the 1st in every Canadian zone, so each port's
// local midnight falls on the same calendar day.
const now = new Date();
const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
const stamp = anchor.toISOString().slice(0, 10);

// Every Nth station serving both series, in code order, so the sample spreads
// across the coast and stays the same from run to run.
const all = await cached("stations", () => iwls.stationList());
const eligible = all
  .filter((s) => ["wlp", "wlp-hilo"].every((c) => s.timeSeries.some((t) => t.code === c)))
  .sort((a, b) => a.code.localeCompare(b.code));
const stride = Math.ceil(eligible.length / SAMPLE_SIZE);
const sample = eligible.filter((_, i) => i % stride === 0);

console.log(
  `Fitting ${sample.length} of ${eligible.length} CHS tide ports: ` +
    `${chsTideFit.days} d planned, ending at local midnight on ${stamp}, ` +
    `held out at +${HOLDOUT_DAYS.join(", +")} d`,
);

interface Stat {
  station: string;
  name: string;
  fit_days: number;
  holdout_days: number;
  fit_rms_cm: number;
  range_cm: number;
  bar_cm: number;
  rmse_cm: number;
  bias_cm: number;
  max_abs_cm: number;
  timing_median_min: number;
  timing_worst_min: number;
  height_median_cm: number;
  matched: number;
  events: number;
  pass: boolean;
}

const stats: Stat[] = [];
const skipped: string[] = [];
// Transient failures back to back mean IWLS itself is down or throttling the run.
// Each can spend half an hour in rate-limit waits, so stop rather than wait out every port.
// A port's own data problem (no time zone, a 404) is skipped without counting.
const MAX_OUTAGES_IN_A_ROW = 3;
let outagesInARow = 0;

function skip(label: string, error: unknown) {
  skipped.push(`${label} (${reason(error)})`);
  const outage = (error instanceof IwlsError && error.kind === "transient") || isTransient(error);
  // A port's own data problem means IWLS answered, which ends a run of outages.
  if (!outage) {
    outagesInARow = 0;
    return;
  }
  if (++outagesInARow >= MAX_OUTAGES_IN_A_ROW) {
    throw new Error(`IWLS failed ${outagesInARow} times in a row; skipped: ${skipped.join(", ")}`);
  }
}

for (const station of sample) {
  // The contract's retries are sized for a device queue that tries again later;
  // here a port that still fails is skipped, so one bad hour keeps the run.
  let fitEnd: number;
  let grid: Sample[];
  try {
    ({ fitEnd, grid } = await fitInputs(station));
    outagesInARow = 0;
  } catch (error) {
    skip(station.code, error);
    continue;
  }
  if (grid.length < 1 + 2 * chsTideFit.basis.length) {
    skipped.push(station.code);
    continue;
  }
  const result = fit(
    grid.map((s) => ({ time: new Date(s.t), value: s.v })),
    chsTideFit.basis,
  );
  const predictor = createTidePredictor(result.constituents, { offset: result.offset });

  for (const holdout of HOLDOUT_DAYS) {
    const start = fitEnd + holdout * DAY;
    const end = start + 7 * DAY;
    let truth: Sample[];
    let hilo: Sample[];
    try {
      truth = await wlp(station, { start, end });
      hilo = await hiloEvents(station, { start, end });
      outagesInARow = 0;
    } catch (error) {
      skip(`${station.code}@+${holdout}`, error);
      continue;
    }
    if (truth.length === 0 || hilo.length < 2) {
      skipped.push(`${station.code}@+${holdout}`);
      continue;
    }

    const errors = truth.map(
      (s) => (predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level - s.v) * 100,
    );
    const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
    const levels = truth.map((s) => s.v);
    const range = (Math.max(...levels) - Math.min(...levels)) * 100;
    const bar = Math.max(HEIGHT_ABS_CM, range * HEIGHT_REL);

    // wlp-hilo has no high/low qualifier, so each event is classified against
    // a neighbour; extremes alternate, so either neighbour will do.
    const extremes = predictor.getExtremesPrediction({
      start: new Date(start - DAY),
      end: new Date(end + DAY),
    });
    const timings: number[] = [];
    const heights: number[] = [];
    hilo.forEach((event, i) => {
      const high = i > 0 ? event.v > hilo[i - 1].v : event.v > hilo[i + 1].v;
      let best: { dt: number; level: number } | undefined;
      for (const e of extremes) {
        if (e.high !== high) continue;
        const dt = Math.abs(e.time.getTime() - event.t) / 60_000;
        if (!best || dt < best.dt) best = { dt, level: e.level };
      }
      if (best && best.dt < MATCH_WINDOW_MIN) {
        timings.push(best.dt);
        heights.push(Math.abs(best.level - event.v) * 100);
      }
    });

    const timingMedian = median(timings);
    const timingWorst = Math.max(...timings);
    const heightMedian = median(heights);
    stats.push({
      station: station.code,
      name: station.officialName,
      fit_days: (grid[grid.length - 1].t - grid[0].t) / DAY,
      holdout_days: holdout,
      fit_rms_cm: result.rms * 100,
      range_cm: range,
      bar_cm: bar,
      rmse_cm: rmse,
      bias_cm: mean(errors),
      max_abs_cm: Math.max(...errors.map(Math.abs)),
      timing_median_min: timingMedian,
      timing_worst_min: timingWorst,
      height_median_cm: heightMedian,
      matched: timings.length,
      events: hilo.length,
      pass:
        timings.length === hilo.length &&
        rmse <= bar &&
        timingMedian <= TIMING_MEDIAN_MAX_MIN &&
        timingWorst <= TIMING_WORST_MAX_MIN &&
        heightMedian <= bar,
    });
  }
  process.stdout.write(".");
}

console.log(`\nSkipped: ${skipped.length ? skipped.join(", ") : "none"}`);

const columns = Object.keys(stats[0] ?? {}) as (keyof Stat)[];
const csv = createWriteStream(join(__dirname, "chs-fit.csv"));
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

for (const holdout of HOLDOUT_DAYS) {
  const rows = stats.filter((s) => s.holdout_days === holdout);
  const rmse = rows.map((s) => s.rmse_cm).sort((a, b) => a - b);
  const passing = rows.filter((s) => s.pass).length;
  const p50 = ntile(rmse, 0.5);
  const p90 = ntile(rmse, 0.9);
  console.log(`+${holdout} d:`, { count: rows.length, passing, p50RmseCm: p50, p90RmseCm: p90 });

  // Skipped ports must not leave the shares below resting on a handful of rows,
  // while the three-port FAST run still tolerates one.
  expect(rows.length, `+${holdout} d stations scored`).toBeGreaterThanOrEqual(
    Math.max(1, Math.floor(0.8 * sample.length)),
  );
  // Baseline expectations from the run recorded in docs/validation/chs-tides.md
  // (fit ending at local midnight 2026-10-01), with margin for other seasons.
  // Most misses are the seasonal mean level; move these toward the bar as the
  // recipe improves.
  expect(passing / rows.length, `+${holdout} d share passing`).toBeGreaterThanOrEqual(0.3);
  expect(p50, `+${holdout} d RMSE p50`).toBeLessThan(12);
  expect(p90, `+${holdout} d RMSE p90`).toBeLessThan(25);
}

// The series the app fits: every chunk of the plan, the oldest chunk's extra
// days included, boundary duplicates kept, ending at the port's local midnight.
async function fitInputs(station: IwlsStation) {
  const { timeZoneCode } = await cached(
    `${station.id}-metadata`,
    () => iwls.metadata(station.id),
    (metadata) => metadata.timeZoneCode !== undefined,
  );
  if (!timeZoneCode) throw new Error("no time zone");
  const fitEnd = localMidnight(anchor, timeZoneCode).getTime();
  const grid: Sample[] = [];
  for (const chunk of chunkPlan(chsTideFit.days, new Date(fitEnd))) {
    grid.push(...(await wlp(station, chunk)));
  }
  grid.sort((a, b) => a.t - b.t);
  return { fitEnd, grid };
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// `wlp` on the fit grid, through the contract client.
function wlp(station: IwlsStation, chunk: Chunk) {
  return cached(
    `${station.id}-wlp-${chunk.start / 1000}-${chunk.end / 1000}-step${chsTideFit.sampleMinutes}m`,
    () => iwls.series("wlp", station.id, chunk, undefined, chsTideFit.sampleMinutes),
    (samples) => samples.length > 0,
  );
}

// wlp-hilo is a scoring input, not a fit series, so it skips the contract's
// grid filter (its events fall between grid points) but keeps its pacing and retries.
function hiloEvents(station: IwlsStation, chunk: Chunk) {
  const url = new URL(`${BASE}/stations/${pathComponent(station.id)}/data`);
  url.search = new URLSearchParams({
    "time-series-code": "wlp-hilo",
    from: new Date(chunk.start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    to: new Date(chunk.end).toISOString().replace(/\.\d{3}Z$/, "Z"),
  }).toString();
  return cached(
    `${station.id}-wlp-hilo-${chunk.start / 1000}-${chunk.end / 1000}`,
    async () => {
      const raw = await iwls.get(url);
      // decode() skips dates it cannot read; for scoring, a lost event is an error, not a gap.
      const unreadable = Array.isArray(raw)
        ? raw.filter((row) => parseEventDate(String(row?.eventDate)) === undefined).length
        : 0;
      if (unreadable) throw new Error(`${unreadable} wlp-hilo events with unreadable dates`);
      return decode(raw);
    },
    (events) => events.length > 0,
  );
}

// The run's own cache, keyed with both chunk ends so a partial week is never
// mistaken for a full one. Empty responses are fetched again next run.
async function cached<T>(
  key: string,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
) {
  const filePath = `./.test-cache/chs-fit-${key}.json`;
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    const value = await load();
    if (keep(value)) await writeFile(filePath, JSON.stringify(value));
    return value;
  }
}

function mean(data: number[]) {
  return data.reduce((a, b) => a + b, 0) / data.length;
}

function median(data: number[]) {
  const s = [...data].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ntile(data: number[], percent: number) {
  return data[Math.floor(data.length * percent)] ?? NaN;
}
