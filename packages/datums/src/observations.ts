import { createTidePredictor, type HarmonicConstituent } from "@slackwater/engine";
import { resolveConstituents } from "./constituents.js";
import {
  mean,
  resolveEpoch,
  rounded,
  type DatumModelOptions,
  type Datums,
  type Sample,
  type TidalDatumsResult,
} from "./datum.js";
import { FIT_SEARCH_HALF_WINDOW_MS, tabulateTurns, type TideTurn } from "./tabulate.js";

const HOUR_MS = 3600000;
// The longest gap, and the furthest anchor beyond it, that the cubic fill bridges.
const MAX_BRACKET_HOURS = 4;
// A longer gap takes the prediction plus a residual interpolated between its edges. IOC Manuals
// and Guides 14 vol. II §5.1.1 recommends filling only gaps under 24 hours; NOAA fills up to
// 3 days (NOS CO-OPS 2 §2.6).
const MAX_FILL_HOURS = 23;
// Our limit on a month's prediction-filled hours, NOAA's 3-day gap limit taken as a monthly total.
const MAX_MONTH_FILL_HOURS = 72;
// Our stand-in for NOAA's condition that a fill matches the gauge and no weather intervenes: a
// larger change in residual across the gap means a surge or a gauge zero shift.
const MAX_FILL_RESIDUAL_CHANGE_M = 0.1;
const YEAR_MONTHS = 12;

// Anchors whose sampling instants are closer than this make the gap's cubic ill-conditioned.
const MIN_ANCHOR_SPACING_HOURS = 0.5;
/** An hourly bin: its UTC hour, mean level, and the mean instant of the samples in it. */
type Hourly = { hour: number; level: number; at: number };
interface HourlyPreparation {
  hourly: Hourly[];
  levels: Map<number, number>;
  /** The instant each bin's level represents, measured or filled. */
  instants: Map<number, number>;
  /** Filled hours, with the level at each one's instant rather than its hourly mean. */
  inferred: Map<number, number>;
  ignored: string[];
}
interface CalendarMonth {
  start: number;
  end: number;
  mean: number | undefined;
}

export interface PreparedDatumObservations {
  /**
   * Hourly heights over the window, measured or filled, each stamped at the start of its hour.
   * A height is the mean of the hour's samples, so it stands for their mean instant, about :27
   * for 6-minute data.
   */
  samples: Sample[];
  start: Date;
  /** Exclusive: the instant after the window's last hour. */
  end: Date;
  coverage: { months: number; observedHours: number; inferredHours: number };
  /** Constituent names the engine doesn't know, left out of the gap-fill model. */
  ignoredConstituents: string[];
}

export interface ObservedTidalDatumsResult extends TidalDatumsResult {
  coverage: PreparedDatumObservations["coverage"];
}

/**
 * The hourly series an observed reduction uses: the longest run of complete UTC calendar
 * months that is a whole number of years, latest on a tie, within the 19 years up to the
 * record's last complete month. Returns null when no run reaches a year.
 */
export function prepareDatumObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[],
  modelOptions: DatumModelOptions = {},
): PreparedDatumObservations | null {
  return prepareWindow(samples, constituents, modelOptions)?.result ?? null;
}

function prepareWindow(
  samples: Sample[],
  constituents: HarmonicConstituent[],
  modelOptions: DatumModelOptions,
): { result: PreparedDatumObservations; prepared: HourlyPreparation } | null {
  const prepared = prepareHourlyObservations(samples, constituents, modelOptions);
  if (!prepared) return null;
  let runMonths = 0,
    bestMonths = 0,
    bestStart = 0,
    bestEnd = 0;
  // Whole years give every season equal representation. Compare the usable
  // whole-year lengths, and choose the latest window on a tie.
  for (const month of recentMonths(prepared)) {
    if (month.mean === undefined) {
      runMonths = 0;
      continue;
    }
    runMonths++;
    const wholeMonths = Math.floor(runMonths / YEAR_MONTHS) * YEAR_MONTHS;
    if (wholeMonths >= YEAR_MONTHS && wholeMonths >= bestMonths) {
      bestMonths = wholeMonths;
      bestEnd = month.end;
      bestStart = shiftMonth(bestEnd, -wholeMonths);
    }
  }
  if (!bestMonths) return null;
  const points: Sample[] = [];
  let inferredHours = 0;
  for (let hour = bestStart; hour < bestEnd; hour++) {
    points.push({ time: new Date(hour * HOUR_MS), level: prepared.levels.get(hour)! });
    if (prepared.inferred.has(hour)) inferredHours++;
  }
  return {
    prepared,
    result: {
      samples: points,
      start: new Date(bestStart * HOUR_MS),
      end: new Date(bestEnd * HOUR_MS),
      coverage: {
        months: bestMonths,
        observedHours: points.length - inferredHours,
        inferredHours,
      },
      ignoredConstituents: prepared.ignored,
    },
  };
}

/**
 * Derive tidal datums from observed water levels, after NOAA's first reduction (Computational
 * Techniques for Tidal Datums Handbook, NOS CO-OPS 2, §2.6 and §3.1) over the window
 * `prepareDatumObservations` chooses, without a control-station correction to a 19-year epoch.
 *
 * High and low waters are tabulated by NOAA's Tidal Analysis Datum Calculator method
 * (`tabulateTurns`) from the observations at their own cadence, filled hours included. Each
 * datum is an arithmetic mean over the window: MHW and MLW of every high or low, MHHW and MLLW
 * of the higher highs and lower lows, and MSL of the hourly heights. The astronomical datums
 * (HAT, LAT, LLWLT, HHWLT) are defined from predictions and are left to `computeDatums`.
 *
 * Returns null when the record has no whole year of complete months, or when that year has
 * no high or no low.
 */
export function computeDatumsFromObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[] = [],
  modelOptions: DatumModelOptions = {},
): ObservedTidalDatumsResult | null {
  const window = prepareWindow(samples, constituents, modelOptions);
  if (!window) return null;
  const { result, prepared } = window;
  // Observations either side of the window shape the fits of the turns near its edges.
  const start = +result.start - FIT_SEARCH_HALF_WINDOW_MS;
  const end = +result.end + FIT_SEARCH_HALF_WINDOW_MS;

  const observed = distinctInstants(samples, start, end);
  const filled: Sample[] = [];
  for (const [hour, level] of prepared.inferred) {
    const time = prepared.instants.get(hour)!;
    if (time >= start && time < end) filled.push({ time: new Date(time), level });
  }
  const observations = filled.length ? merge(observed, filled) : observed;
  const hourly = result.samples.map((p) => ({
    time: new Date(prepared.instants.get(+p.time / HOUR_MS)!),
    level: p.level,
  }));

  const turns = tabulateTurns(hourly, observations);
  const level = (keep: (turn: TideTurn) => boolean) =>
    mean(turns.filter(keep).map((turn) => turn.level));
  const datums: Datums = {
    MHHW: level((turn) => turn.high && turn.higher),
    MHW: level((turn) => turn.high),
    MSL: mean(hourly.map((p) => p.level)),
    MLW: level((turn) => !turn.high),
    MLLW: level((turn) => !turn.high && turn.higher),
  };
  if (!Number.isFinite(datums["MHW"]) || !Number.isFinite(datums["MLW"])) return null;
  datums["MTL"] = (datums["MHW"]! + datums["MLW"]!) / 2;

  return {
    start: result.start,
    end: result.end,
    datums: rounded(datums),
    coverage: result.coverage,
    ignoredConstituents: result.ignoredConstituents,
  };
}

/**
 * The finite samples in [start, end), sorted by time, with samples that share an instant
 * averaged so the result doesn't depend on their order.
 */
function distinctInstants(samples: readonly Sample[], start: number, end: number): Sample[] {
  const inRange = samples.filter(
    (p) => Number.isFinite(p.level) && +p.time >= start && +p.time < end,
  );
  let sorted = true;
  for (let i = 1; i < inRange.length && sorted; i++)
    sorted = +inRange[i - 1]!.time < +inRange[i]!.time;
  if (sorted) return inRange;
  inRange.sort((a, b) => +a.time - +b.time);
  const distinct: Sample[] = [];
  for (let i = 0; i < inRange.length;) {
    let j = i;
    let sum = 0;
    for (; j < inRange.length && +inRange[j]!.time === +inRange[i]!.time; j++)
      sum += inRange[j]!.level;
    distinct.push(j - i > 1 ? { time: inRange[i]!.time, level: sum / (j - i) } : inRange[i]!);
    i = j;
  }
  return distinct;
}

/** Two series sorted by time, merged in order; a filled point never shares a measured instant. */
export function merge(a: readonly Sample[], b: readonly Sample[]): Sample[] {
  const sortedB = [...b].sort((x, y) => +x.time - +y.time);
  const merged: Sample[] = [];
  let j = 0;
  for (const p of a) {
    while (j < sortedB.length && +sortedB[j]!.time < +p.time) merged.push(sortedB[j++]!);
    merged.push(p);
  }
  while (j < sortedB.length) merged.push(sortedB[j++]!);
  return merged;
}

/** Fallback gauge offset: complete prepared months, balanced across all seasons.
 * The months need not be contiguous, so this does not qualify an observed
 * high/low reduction or describe a single datum epoch. */
export function observedMeanLevel(
  samples: Sample[],
  constituents: HarmonicConstituent[] = [],
  modelOptions: DatumModelOptions = {},
): number | undefined {
  const prepared = prepareHourlyObservations(samples, constituents, modelOptions);
  if (!prepared) return undefined;
  const seasons = Array.from({ length: YEAR_MONTHS }, () => [] as number[]);
  for (const month of recentMonths(prepared))
    if (month.mean !== undefined)
      seasons[new Date(month.start * HOUR_MS).getUTCMonth()]!.push(month.mean);
  if (seasons.some((months) => !months.length)) return undefined;
  return (
    seasons.reduce((sum, months) => sum + months.reduce((a, b) => a + b, 0) / months.length, 0) /
    YEAR_MONTHS
  );
}

function prepareHourlyObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[],
  modelOptions: DatumModelOptions,
): HourlyPreparation | null {
  const { tidal, ignored } = resolveConstituents(constituents, modelOptions.definitions);
  // The constants predict under the corrections they were fitted with, or the gap fill drifts.
  // The engine gets the constants as given, so it refuses what it refuses, and builds before
  // any early return, so invalid options fail whether or not the record has gaps.
  const model = createTidePredictor(constituents, modelOptions);
  // A model with no daily or faster tide would fill a gap with a nearly straight line.
  const predictor = tidal ? model : undefined;
  const distinct = distinctInstants(samples, -Infinity, Infinity);
  const hourly = hourlyBins(distinct);
  if (!hourly.length) return null;
  const levels = new Map(hourly.map((p) => [p.hour, p.level]));
  const instants = new Map(hourly.map((p) => [p.hour, p.at]));
  const inferred = new Map<number, number>();
  const unfilled = { hourly, levels, instants, inferred, ignored };
  if (!predictor) return unfilled;

  const gaps: Hourly[][] = [];
  const spans: [Hourly, Hourly][] = [];
  const profiles = new Map<number, number[]>();
  // Two real hours in a row on each side, so a lone reading inside an outage can't join two fills.
  const edged = (before?: Hourly, left?: Hourly, right?: Hourly, after?: Hourly) =>
    before?.hour === left!.hour - 1 && after?.hour === right!.hour + 1;
  for (let i = 0; i < hourly.length - 1; i++) {
    const before = hourly[i - 1],
      left = hourly[i]!,
      right = hourly[i + 1]!,
      after = hourly[i + 2];
    const separation = right.hour - left.hour;
    if (separation <= 1 || separation > MAX_FILL_HOURS + 1) continue;
    if (
      before &&
      after &&
      separation <= MAX_BRACKET_HOURS &&
      left.hour - before.hour <= MAX_BRACKET_HOURS &&
      after.hour - right.hour <= MAX_BRACKET_HOURS
    ) {
      gaps.push([before, left, right, after]);
      for (const p of [before, left, right, after]) profiles.set(p.hour, []);
    } else if (edged(before, left, right, after)) {
      spans.push([left, right]);
      profiles.set(left.hour, []);
      profiles.set(right.hour, []);
    }
  }
  if (!gaps.length && !spans.length) return unfilled;
  // Compare averaged measurements with averaged predictions at the same sample
  // instants. Retain sampling profiles only for the real anchors around gaps.
  for (const p of distinct) {
    const hour = Math.floor(+p.time / HOUR_MS);
    profiles.get(hour)?.push(+p.time - hour * HOUR_MS);
  }
  const predictions = new Map<number, number>();
  const prediction = (time: number) => {
    if (!predictions.has(time))
      predictions.set(time, predictor.getWaterLevelAtTime({ time: new Date(time) }).level);
    return predictions.get(time)!;
  };
  const binPrediction = (hour: number, profile: number[]) =>
    profile.reduce((sum, offset) => sum + prediction(hour * HOUR_MS + offset), 0) / profile.length;
  for (const anchors of gaps) {
    const left = anchors[1]!,
      right = anchors[2]!;
    const positions = anchors.map(
      (p) => p.hour - left.hour + mean(profiles.get(p.hour)!) / HOUR_MS,
    );
    if (positions.some((x, k) => k > 0 && x - positions[k - 1]! < MIN_ANCHOR_SPACING_HOURS)) {
      if (edged(...(anchors as [Hourly, Hourly, Hourly, Hourly]))) spans.push([left, right]);
      continue;
    }
    // A bin residual is an average at its sampling instants, not a point at
    // the integer hour. Fit those averages so changing cadence cannot shift it.
    const coefficients = solveCubic(
      anchors.map((p) => [
        ...samplingMoments(p.hour - left.hour, profiles.get(p.hour)!),
        p.level - binPrediction(p.hour, profiles.get(p.hour)!),
      ]),
    );
    for (let hour = left.hour + 1; hour < right.hour; hour++) {
      // A missing bin follows its nearer real neighbour's sampling cadence.
      const profile = profiles.get(hour - left.hour <= right.hour - hour ? left.hour : right.hour)!;
      const moments = samplingMoments(hour - left.hour, profile);
      const residual = coefficients.reduce((sum, c, degree) => sum + c * moments[degree]!, 0);
      const level = binPrediction(hour, profile) + residual;
      if (Number.isFinite(level)) {
        const instant = hour * HOUR_MS + mean(profile);
        const x = (instant - left.hour * HOUR_MS) / HOUR_MS;
        levels.set(hour, level);
        instants.set(hour, instant);
        inferred.set(
          hour,
          prediction(instant) + coefficients.reduce((sum, c, degree) => sum + c * x ** degree, 0),
        );
      }
    }
  }
  // The residual is an average at each edge bin's sampling instants, so it sits at their mean.
  const residualAt = (p: Hourly) => ({
    x: p.hour + mean(profiles.get(p.hour)!) / HOUR_MS,
    residual: p.level - binPrediction(p.hour, profiles.get(p.hour)!),
  });
  // A month whose spans hold more hours than the cap stays incomplete whichever of them fill, so
  // count them first and skip predicting for it.
  const spanHours = new Map<number, number>();
  for (const [left, right] of spans)
    for (let hour = left.hour + 1; hour < right.hour; hour++)
      spanHours.set(monthStart(hour), (spanHours.get(monthStart(hour)) ?? 0) + 1);
  for (const [left, right] of spans) {
    const a = residualAt(left),
      b = residualAt(right);
    if (!(Math.abs(b.residual - a.residual) <= MAX_FILL_RESIDUAL_CHANGE_M)) continue;
    const residual = (x: number) =>
      a.residual + ((x - a.x) / (b.x - a.x)) * (b.residual - a.residual);
    for (let hour = left.hour + 1; hour < right.hour; hour++) {
      if (spanHours.get(monthStart(hour))! > MAX_MONTH_FILL_HOURS) continue;
      const profile = profiles.get(hour - left.hour <= right.hour - hour ? left.hour : right.hour)!;
      const instant = hour * HOUR_MS + mean(profile);
      levels.set(hour, binPrediction(hour, profile) + residual(instant / HOUR_MS));
      instants.set(hour, instant);
      inferred.set(hour, prediction(instant) + residual(instant / HOUR_MS));
    }
  }
  return { hourly, levels, instants, inferred, ignored };
}

function samplingMoments(hour: number, profile: number[]): number[] {
  const moments = [1, 0, 0, 0];
  for (const offset of profile) {
    const x = hour + offset / HOUR_MS;
    for (let degree = 1; degree <= 3; degree++) moments[degree]! += x ** degree / profile.length;
  }
  return moments;
}

/**
 * Solve the four bin-average constraints for a cubic residual. Anchors at least half an hour
 * apart keep the system well away from singular.
 */
function solveCubic(rows: number[][]): number[] {
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    for (let row = column + 1; row < 4; row++) {
      const factor = rows[row]![column]! / rows[column]![column]!;
      for (let k = column; k <= 4; k++) rows[row]![k]! -= factor * rows[column]![k]!;
    }
  }
  const coefficients = [0, 0, 0, 0];
  for (let row = 3; row >= 0; row--) {
    let value = rows[row]![4]!;
    for (let k = row + 1; k < 4; k++) value -= rows[row]![k]! * coefficients[k]!;
    coefficients[row] = value / rows[row]![row]!;
  }
  return coefficients;
}

/** The calendar months within the 19 years up to the record's last complete month. */
function recentMonths(prepared: HourlyPreparation): CalendarMonth[] {
  const months = calendarMonths(prepared);
  let last: CalendarMonth | undefined;
  for (const month of months) if (month.mean !== undefined) last = month;
  if (!last) return [];
  const lastEnd = last.end;
  const { start } = resolveEpoch({ end: new Date(last.end * HOUR_MS) });
  return months.filter((month) => month.start * HOUR_MS >= +start && month.end <= lastEnd);
}

function calendarMonths({ hourly, levels }: HourlyPreparation): CalendarMonth[] {
  const first = hourly[0]!.hour,
    last = hourly[hourly.length - 1]!.hour;
  let month = monthStart(first);
  if (month < first) month = shiftMonth(month, 1);
  const months: CalendarMonth[] = [];
  for (; month <= last; month = shiftMonth(month, 1)) {
    const end = shiftMonth(month, 1);
    if (end - 1 > last) break;
    let sum = 0,
      complete = true;
    for (let hour = month; hour < end; hour++) {
      const level = levels.get(hour);
      if (level === undefined) {
        complete = false;
        break;
      }
      sum += level;
    }
    months.push({
      start: month,
      end,
      mean: complete && Number.isFinite(sum) ? sum / (end - month) : undefined,
    });
  }
  return months;
}

/** Distinct finite samples, in time order, averaged into UTC hourly bins. */
function hourlyBins(samples: readonly Sample[]): Hourly[] {
  const buckets = new Map<number, { sum: number; time: number; n: number }>();
  for (const p of samples) {
    const hour = Math.floor(+p.time / HOUR_MS),
      bucket = buckets.get(hour) ?? { sum: 0, time: 0, n: 0 };
    bucket.sum += p.level;
    bucket.time += +p.time;
    bucket.n++;
    buckets.set(hour, bucket);
  }
  return [...buckets]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, b]) => ({ hour, level: b.sum / b.n, at: b.time / b.n }));
}
function monthStart(hour: number): number {
  const time = new Date(hour * HOUR_MS);
  return Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1) / HOUR_MS;
}
function shiftMonth(hour: number, months: number): number {
  const time = new Date(hour * HOUR_MS);
  return Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + months, 1) / HOUR_MS;
}
