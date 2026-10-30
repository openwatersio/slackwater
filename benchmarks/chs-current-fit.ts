// Fits the curated CHS current gates with `chsCurrentFit` exactly as the apps
// fit them, and scores each fit's held-out weeks against CHS's published
// `wcp1-events`. The fit inputs follow the IWLS fetching contract
// (docs/iwls-fetch.md): the window ends at the gate's local midnight on a
// grid point's date (chs-current-grid.ts) and spans the app's chunk plan. The
// run writes rows, not verdicts; the results repository pools a year of
// them (docs/validation/chs-currents.md).
//
// GRID=-13..-1 or GRID=-2,-1 picks grid points, FIT_END=YYYY-MM-DD the one
// ending that day, and neither the newest on or before today.
// WINDOWS=60,210,365 adds the report-only 365-day window. GATES=path.json
// scores [{ id, latitude, longitude }] in place of the curated gates in
// @slackwater/database. NO_FLOORS=1 skips the share and p50 assertions but
// still checks for reversed axes, requires every group short of the horizon,
// report-only windows included, to have scored rows, and requires the run to
// have one. ROWS_ONLY=1 records rows without judging them, for the results
// repository: it skips the reversed-axis, per-group and run-level scored
// checks as well as the floors, and keeps the check that no two gates resolve
// to the same IWLS station. Any non-empty value turns FAST or NO_FLOORS on, 0
// included; ROWS_ONLY takes only 1. FAST=1 scores three gates at +28 d.
// OUT=dir writes the outputs somewhere other than benchmarks/.
import { expect } from "vitest";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadStations } from "@slackwater/database";
import {
  chsCurrentFit,
  createCurrentPredictor,
  fit,
  projectChsCurrent,
  type HarmonicFit,
} from "@slackwater/engine";
import {
  BASE,
  IwlsError,
  canCache,
  chunkPlan,
  createClient,
  localMidnight,
  pathComponent,
  resolve,
  type Chunk,
  type IwlsStation,
  type Sample,
} from "./iwls.ts";
import {
  CONTEXT_MIN,
  OFFSET_DAYS,
  WEEK_DAYS,
  fitEndDate,
  requestSpans,
  selectGrid,
  withinHorizon,
} from "./chs-current-grid.ts";
import {
  SCORER_VERSION,
  hasSlackOrExtremum,
  parseEvents,
  rounded,
  scoreWeek,
  summarize,
  type GateFailure,
  type GateRecord,
  type ResultRow,
  type RowStatus,
  type ScoreEvent,
  type WeekScore,
} from "./chs-current-score.ts";

const __dirname = new URL(".", import.meta.url).pathname;
const DAY = 86_400_000;
// Each held-out week's events and predictions span its pairing context.
const CONTEXT = CONTEXT_MIN * 60_000;
const iwls = createClient();

const FAST = !!process.env.FAST;
// ROWS_ONLY turns off the only check that sees a reversed axis, so 0 or false
// must not turn it on.
if (![undefined, "", "1"].includes(process.env.ROWS_ONLY)) {
  throw new Error(`ROWS_ONLY takes 1 or nothing, not ${JSON.stringify(process.env.ROWS_ONLY)}`);
}
const ROWS_ONLY = process.env.ROWS_ONLY === "1";
const NO_FLOORS = ROWS_ONLY || !!process.env.NO_FLOORS;
const OUT = process.env.OUT ?? __dirname;
const OFFSETS: readonly number[] = FAST ? [28] : OFFSET_DAYS;
const WINDOWS = (process.env.WINDOWS ?? chsCurrentFit.days.join(",")).split(",").map(Number);
if (WINDOWS.some((d) => !Number.isInteger(d) || d <= 0)) {
  throw new Error(`WINDOWS needs whole days: ${process.env.WINDOWS}`);
}
const longest = Math.max(...WINDOWS);
// A past week whose CHS predictions should never change. A different hash
// from one run to the next means CHS revised its predictions under the history.
const CANARY: Chunk = {
  start: Date.parse("2026-01-01T00:00:00Z"),
  end: Date.parse("2026-01-08T00:00:00Z"),
};
// Malibu Rapids' slack derives from a tide port; it has no current station.
const NOT_FITTED = new Set(["chs-malibu-rapids"]);
const NOT_FITTED_REASON = "not fitted: its slack derives from a tide port";

/** A gate's own data problem: recorded as its reason or failure, and the run goes on. */
class GateDataError extends Error {}
// Transient failures end the run, so a results run never commits a grid point
// that silently lacks a gate.
const isPermanent = (error: unknown) =>
  error instanceof GateDataError || (error instanceof IwlsError && error.kind === "permanent");

await mkdir(".test-cache", { recursive: true });
await mkdir(OUT, { recursive: true });

const grid = selectGrid(process.env, new Date().toISOString().slice(0, 10));
interface Gate {
  id: string;
  latitude: number;
  longitude: number;
}
const curated: Gate[] = process.env.GATES
  ? JSON.parse(await readFile(process.env.GATES, "utf-8"))
  : (await loadStations()).accepted.filter(
      (s) => s.kind === "current" && s.source.name === "Canadian Hydrographic Service",
    );
const byId = (a: Gate, b: Gate) => a.id.localeCompare(b.id);
const gates = curated
  .filter((g) => !NOT_FITTED.has(g.id))
  .sort(byId)
  .slice(0, FAST ? 3 : Infinity);

console.log(
  `Fitting ${gates.length} CHS current gates at ${WINDOWS.join(" and ")} d, grid points ${grid.join(", ")} ` +
    `(fits ending ${grid.map(fitEndDate).join(", ")}), held out at +${OFFSETS.join(", +")} d, stamp ${chsCurrentFit.stamp}`,
);

const servesSpeed = (s: IwlsStation) =>
  s.timeSeries.some((t) => t.code === chsCurrentFit.speedSeries);
// A list with no current station would give every gate the same reason, so it
// is never cached and it ends the run instead.
const list = await cached(
  "stations",
  () => iwls.stationList(),
  (l) => l.some(servesSpeed),
);
if (!list.some(servesSpeed)) {
  throw new Error(`the IWLS station list has no station serving ${chsCurrentFit.speedSeries}`);
}
const rows: ResultRow[] = [];
const records: GateRecord[] = curated
  .filter((g) => NOT_FITTED.has(g.id))
  .sort(byId)
  .map((g) => ({ gate: g.id, reason: NOT_FITTED_REASON }));

for (const gate of gates) {
  const record: GateRecord = { gate: gate.id };
  try {
    const station = resolve(
      gate.id,
      gate.latitude,
      gate.longitude,
      chsCurrentFit.speedSeries,
      list,
    );
    record.iwls = station.code;
    const meta = await cached(
      `${station.id}-metadata`,
      () => iwls.metadata(station.id),
      (m) =>
        m.timeZoneCode !== undefined &&
        m.floodDirection !== undefined &&
        m.ebbDirection !== undefined,
    );
    if (!meta.timeZoneCode) throw new GateDataError("no time zone in IWLS metadata");
    if (meta.floodDirection === undefined || meta.ebbDirection === undefined) {
      throw new GateDataError("no flood axis in IWLS metadata");
    }
    const axis = {
      flood: meta.floodDirection,
      ebb: meta.ebbDirection,
      timeZone: meta.timeZoneCode,
    };
    Object.assign(record, { flood: axis.flood, ebb: axis.ebb, time_zone: axis.timeZone });
    const horizon = await eventHorizon(station);
    record.horizon = iso(horizon);
    try {
      record.canary = await canary(station);
    } catch (error) {
      // The canary is a diagnostic, so a permanent refusal leaves it out and
      // the gate's rows still land. A transient failure still ends the run.
      if (!(error instanceof IwlsError && error.kind === "permanent")) throw error;
      console.log(`${gate.id}: canary left out: ${error.message}`);
    }
    // Every grid point and window has rows or a failure of its own, so one
    // that IWLS cannot serve or that will not fit costs only its own rows.
    const failures: GateFailure[] = [];
    for (const i of grid) {
      try {
        rows.push(...(await scoreGridPoint(gate, station, axis, i, horizon, failures)));
      } catch (error) {
        if (!isPermanent(error)) throw error;
        failures.push({ grid: i, reason: (error as Error).message });
      }
    }
    if (failures.length) record.failures = failures;
  } catch (error) {
    if (!isPermanent(error)) throw error;
    record.reason = (error as Error).message;
  }
  records.push(record);
  process.stdout.write(".");
}
console.log();

await writeLines(join(OUT, "chs-current-fit.jsonl"), rows);
await writeLines(join(OUT, "chs-current-gates.jsonl"), records);
writeSummary(join(OUT, "chs-current-fit.csv"), rows);

for (const r of records) {
  if (r.reason) console.log(`${r.gate}: ${r.reason}`);
  for (const f of r.failures ?? []) console.log(`${r.gate}: grid ${f.grid}: ${f.reason}`);
}
const codes = records.filter((r) => r.iwls && !r.reason).map((r) => r.iwls);
expect(
  records
    .filter((r) => r.iwls && !r.reason && codes.indexOf(r.iwls) !== codes.lastIndexOf(r.iwls))
    .map((r) => r.gate),
  "gates resolved to the same IWLS station",
).toEqual([]);

// The floors hold the recipe's own windows, never a report-only one.
const recipeDays: readonly number[] = chsCurrentFit.days;
for (const i of grid) {
  for (const days of WINDOWS) {
    for (const offset of OFFSETS) {
      const group = rows.filter(
        (r) => r.grid === i && r.fit_days === days && r.offset_days === offset,
      );
      const scored = group
        .filter((r) => r.status === "scored")
        .map((r) => summarize(r as WeekScore));
      const passing = scored.filter((s) => s.pass).length;
      const slack = scored
        .map((s) => s.slack_median_min)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const p50 = slack[Math.floor(slack.length * 0.5)] ?? NaN;
      console.log(`grid ${i} (${fitEndDate(i)}), ${days} d fit, +${offset} d:`, {
        scored: scored.length,
        noEvents: group.filter((r) => r.status === "no_events").length,
        beyondHorizon: group.filter((r) => r.status === "beyond_horizon").length,
        passing,
        p50SlackMedianMin: p50,
      });
      // Short of ROWS_ONLY, an empty group is a failure, not a skip, even under
      // NO_FLOORS and for a report-only window: every gate recording a reason
      // or failure would otherwise pass vacuously.
      const allBeyond = group.length > 0 && group.every((r) => r.status === "beyond_horizon");
      if (allBeyond) continue;
      // In ROWS_ONLY a shard's groups can be empty when its gates all have a
      // reason or a failure, as a one-gate backfill can, and a reversed axis is
      // one gate's disqualifier. The results repository checks across every
      // shard that each grid point, recipe window and held-out week short of
      // the horizon scored a gate.
      if (ROWS_ONLY) continue;
      expect(scored.length, `grid ${i} ${days} d +${offset} d gates scored`).toBeGreaterThan(0);
      if (!recipeDays.includes(days)) continue;
      // A reversed axis keeps its slack times, so its rows score as usual and
      // only this check sees it. It depends on no calibration, so NO_FLOORS
      // keeps it.
      expect(
        scored.filter((s) => s.reversed).length,
        `grid ${i} ${days} d +${offset} d reversed axes`,
      ).toBe(0);
      if (NO_FLOORS) continue;
      // Floors set under scorer version 1 from the run with the fit ending
      // 2026-10-01 in docs/validation/chs-currents.md, at least one gate below
      // its worst held-out week; #437 tracks recalibrating them. The share
      // counts a gate with no row here, for a reason or a failure, as a miss.
      const baseline =
        days === chsCurrentFit.days[0] ? { share: 0.05, p50: 20 } : { share: 0.3, p50: 15 };
      expect(
        passing / gates.length,
        `grid ${i} ${days} d +${offset} d share passing`,
      ).toBeGreaterThanOrEqual(baseline.share);
      expect(p50, `grid ${i} ${days} d +${offset} d slack median p50`).toBeLessThan(baseline.p50);
    }
  }
}
// Every group above is skipped when every week lies beyond the horizon, as
// when every gate's current-year probe came back empty, so the run as a whole
// must still have scored something. In ROWS_ONLY the results repository
// checks that across every shard, since a one-gate shard's gate can have a
// reason in place of rows.
const counted = (status: RowStatus) => rows.filter((r) => r.status === status).length;
if (!ROWS_ONLY) {
  expect(
    counted("scored"),
    `rows scored (${counted("beyond_horizon")} beyond the horizon, ${counted("no_events")} with no slack or extremum)`,
  ).toBeGreaterThan(0);
}

async function scoreGridPoint(
  gate: Gate,
  station: IwlsStation,
  axis: { flood: number; ebb: number; timeZone: string },
  i: number,
  horizon: number,
  failures: GateFailure[],
): Promise<ResultRow[]> {
  const date = fitEndDate(i);
  // Midday UTC is the same calendar day in every Canadian zone.
  const fitEnd = localMidnight(new Date(`${date}T12:00:00Z`), axis.timeZone).getTime();
  // Every chunk of the longest window's plan, newest first, each kept apart so
  // a shorter window can take exactly its own plan's chunks.
  const fetched: { speeds: Sample[]; directions: Sample[] }[] = [];
  for (const chunk of chunkPlan(longest, new Date(fitEnd))) {
    fetched.push({
      speeds: await series(chsCurrentFit.speedSeries, station, chunk),
      directions: await series(chsCurrentFit.directionSeries, station, chunk),
    });
  }
  const harmonic = (s: Sample[]) =>
    [...s].sort((a, b) => a.t - b.t).map((x) => ({ time: new Date(x.t), value: x.v }));

  const out: ResultRow[] = [];
  for (const days of WINDOWS) {
    // A window fits exactly its own plan's chunks, as the app does, boundary
    // duplicates kept. Both plans share the epoch grid and the end, so the
    // window's chunks are the newest ones of the longest plan, already fetched.
    const plan = chunkPlan(days, new Date(fitEnd));
    const own = fetched.slice(0, plan.length);
    const start = plan.at(-1)!.start;
    const samples = projectChsCurrent(
      harmonic(own.flatMap((c) => c.speeds)),
      harmonic(own.flatMap((c) => c.directions)),
      axis.flood,
    );
    // A window too short or degenerate to fit, such as a rank-deficient one,
    // is the gate's own data problem, and the grid point's other windows
    // still score.
    if (samples.length < 1 + 2 * chsCurrentFit.basis.length) {
      failures.push({
        grid: i,
        fit_days: days,
        reason: `IWLS served ${samples.length} samples for the ${days}-day fit ending ${date}`,
      });
      continue;
    }
    let result: HarmonicFit;
    try {
      result = fit(samples, chsCurrentFit.basis);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      failures.push({
        grid: i,
        fit_days: days,
        reason: `the ${days}-day fit ending ${date} failed: ${error.message}`,
      });
      continue;
    }
    const predictor = createCurrentPredictor(result.constituents, {
      floodDirection: axis.flood,
      ebbDirection: axis.ebb,
      meanFlow: result.offset,
    });
    for (const offset of OFFSETS) {
      const weekStart = fitEnd + offset * DAY;
      const weekEnd = weekStart + WEEK_DAYS * DAY;
      const base: ResultRow = {
        gate: gate.id,
        iwls: station.code,
        flood: axis.flood,
        stamp: chsCurrentFit.stamp,
        scorer: SCORER_VERSION,
        grid: i,
        fit_end: iso(fitEnd),
        fit_days: days,
        fit_start: iso(start),
        fit_samples: samples.length,
        fit_rms_kn: Math.round(result.rms * 1000) / 1000,
        offset_days: offset,
        week_start: iso(weekStart),
        status: "scored",
      };
      if (!withinHorizon(fitEnd, horizon, [offset])) {
        out.push({ ...base, status: "beyond_horizon" });
        continue;
      }
      const observed = await events(station, weekStart - CONTEXT, weekEnd + CONTEXT);
      if (!hasSlackOrExtremum(observed.filter((e) => e.time >= weekStart && e.time < weekEnd))) {
        out.push({ ...base, status: "no_events" });
        continue;
      }
      const predicted: ScoreEvent[] = predictor
        .getEventsPrediction({
          start: new Date(weekStart - CONTEXT),
          end: new Date(weekEnd + CONTEXT),
        })
        .map((e) => ({ time: e.time.getTime(), kind: e.kind, speed: e.speed }));
      const score = scoreWeek({
        start: weekStart,
        end: weekEnd,
        observed,
        predicted,
        velocityAt: (t) =>
          predictor.getTimelinePrediction({
            start: new Date(t),
            end: new Date(t + 60_000),
            timeFidelity: 60,
          })[0].speed,
      });
      out.push({ ...base, ...rounded(score) });
    }
  }
  return out;
}

// CHS publishes events a calendar year at a time. The horizon is the end of
// the last year whose final week has events, probing forward from this one.
// Never cached: a cached answer would hide next year's publication.
async function eventHorizon(station: IwlsStation): Promise<number> {
  const thisYear = new Date().getUTCFullYear();
  let horizon = Date.UTC(thisYear, 0, 1);
  for (let year = thisYear; year < thisYear + 5; year++) {
    const end = Date.UTC(year + 1, 0, 1);
    let published: ScoreEvent[];
    try {
      published = parseEvents(await iwls.get(eventsURL(station, end - WEEK_DAYS * DAY, end)));
    } catch (error) {
      // A permanent refusal of a later year means CHS has not published it,
      // not that the gate is broken.
      if (year > thisYear && error instanceof IwlsError && error.kind === "permanent") break;
      throw error;
    }
    // Any event counts: a weak-and-variable event alone still means CHS published the year.
    if (published.length === 0) break;
    horizon = end;
  }
  return horizon;
}

// Never cached, so a revision shows on the next run.
async function canary(station: IwlsStation): Promise<string> {
  const samples = await iwls.series(
    chsCurrentFit.speedSeries,
    station.id,
    CANARY,
    undefined,
    chsCurrentFit.sampleMinutes,
  );
  return createHash("sha256").update(JSON.stringify(samples)).digest("hex").slice(0, 12);
}

function eventsURL(station: IwlsStation, from: number, to: number): URL {
  const url = new URL(`${BASE}/stations/${pathComponent(station.id)}/data`);
  url.search = new URLSearchParams({
    "time-series-code": "wcp1-events",
    from: iso(from),
    to: iso(to),
  }).toString();
  return url;
}

// wcp1-events is a scoring input, not a fit series, so it skips the
// contract's grid filter but keeps its pacing, retries and seven-day request
// limit. An event on the instant two requests share comes back from both.
function events(station: IwlsStation, from: number, to: number): Promise<ScoreEvent[]> {
  return cached(
    // The cache holds parsed events, so a scorer that parses differently must refetch them.
    `${station.id}-wcp1-events-scorer${SCORER_VERSION}-${from / 1000}-${to / 1000}`,
    async () => {
      const all: ScoreEvent[] = [];
      for (const [a, b] of requestSpans(from, to)) {
        for (const e of parseEvents(await iwls.get(eventsURL(station, a, b)))) {
          if (!all.some((x) => x.time === e.time && x.kind === e.kind)) all.push(e);
        }
      }
      return all;
    },
    (e) => e.length > 0,
  );
}

function series(code: string, station: IwlsStation, chunk: Chunk): Promise<Sample[]> {
  return cached(
    `${station.id}-${code}-${chunk.start / 1000}-${chunk.end / 1000}-step${chsCurrentFit.sampleMinutes}m`,
    () => iwls.series(code, station.id, chunk, undefined, chsCurrentFit.sampleMinutes),
    (samples) => canCache(chunk, samples, chsCurrentFit.sampleMinutes),
  );
}

// The run's own cache, keyed with both chunk ends. A value `keep` refuses, such
// as an empty response or a series short of a full week with both endpoints,
// is fetched again next run. Reuse checks `keep` again, so an entry an older
// rule kept is fetched again too.
async function cached<T>(
  key: string,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
) {
  const filePath = `./.test-cache/chs-current-fit-${key}.json`;
  let stored: T | undefined;
  try {
    stored = JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    // Not cached yet, or unreadable: fetch it.
  }
  if (stored !== undefined && keep(stored)) return stored;
  const value = await load();
  if (keep(value)) await writeFile(filePath, JSON.stringify(value));
  return value;
}

async function writeLines(path: string, items: object[]) {
  await writeFile(path, items.map((item) => JSON.stringify(item) + "\n").join(""));
}

function writeSummary(path: string, items: ResultRow[]) {
  const columns = [
    "gate",
    "grid",
    "fit_end",
    "fit_days",
    "offset_days",
    "status",
    "slacks",
    "missed",
    "invented",
    "slack_median_min",
    "slack_worst_min",
    "extrema",
    "extrema_scored",
    "extremum_median_min",
    "speed_median_kn",
    "wrong_sign",
    "pass",
  ];
  const csv = createWriteStream(path);
  csv.write(columns.join(",") + "\n");
  for (const r of items) {
    const line: Record<string, unknown> = {
      ...r,
      ...(r.status === "scored" ? summarize(r as WeekScore) : {}),
    };
    csv.write(
      columns
        .map((c) => {
          const v = line[c];
          if (v === undefined) return "";
          if (typeof v !== "number") return JSON.stringify(v);
          return Number.isInteger(v) ? String(v) : v.toFixed(2);
        })
        .join(",") + "\n",
    );
  }
  csv.end();
}

function iso(ms: number) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
