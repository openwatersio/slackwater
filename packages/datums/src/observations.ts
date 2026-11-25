import {
  createTidePredictor,
  type HarmonicConstituent,
} from "@slackwater/engine";
import { resolveEpoch, type Sample } from "./datum.ts";

const HOUR_MS = 3600000;
// Project eligibility limits, not an equivalence to NOAA's datum epoch.
const MAX_BRACKET_HOURS = 4;
const YEAR_MONTHS = 12;
type Hourly = { hour: number; level: number };
interface HourlyPreparation {
  hourly: Hourly[];
  levels: Map<number, number>;
  inferred: Set<number>;
}

export interface PreparedDatumObservations {
  samples: Sample[];
  start: Date;
  end: Date;
  coverage: { months: number; observedHours: number; inferredHours: number };
}

export function prepareDatumObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[],
): PreparedDatumObservations | null {
  const prepared = prepareHourlyObservations(samples, constituents);
  if (!prepared) return null;
  let runMonths = 0,
    bestMonths = 0,
    bestStart = 0,
    bestEnd = 0;
  // Whole years give every season equal representation. Compare the usable
  // whole-year lengths, and choose the latest window on a tie.
  for (const month of calendarMonths(prepared)) {
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
    points.push({
      time: new Date(hour * HOUR_MS),
      level: prepared.levels.get(hour)!,
    });
    if (prepared.inferred.has(hour)) inferredHours++;
  }
  return {
    samples: points,
    start: points[0]!.time,
    end: points[points.length - 1]!.time,
    coverage: {
      months: bestMonths,
      observedHours: points.length - inferredHours,
      inferredHours,
    },
  };
}

/** Fallback gauge offset: complete prepared months, balanced across all seasons.
 * The months need not be contiguous, so this does not qualify an observed
 * high/low reduction or describe a single datum epoch. */
export function observedMeanLevel(
  samples: Sample[],
  constituents: HarmonicConstituent[] = [],
): number | undefined {
  const prepared = prepareHourlyObservations(samples, constituents);
  if (!prepared) return undefined;
  const seasons = Array.from({ length: YEAR_MONTHS }, () => [] as number[]);
  for (const month of calendarMonths(prepared))
    if (month.mean !== undefined)
      seasons[new Date(month.start * HOUR_MS).getUTCMonth()]!.push(month.mean);
  if (seasons.some((months) => !months.length)) return undefined;
  return (
    seasons.reduce(
      (sum, months) => sum + months.reduce((a, b) => a + b, 0) / months.length,
      0,
    ) / YEAR_MONTHS
  );
}

function prepareHourlyObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[],
): HourlyPreparation | null {
  const hourly = hourlyWindow(samples);
  if (!hourly.length) return null;
  const levels = new Map(hourly.map((p) => [p.hour, p.level]));
  const inferred = new Set<number>();
  if (!constituents.length) return { hourly, levels, inferred };

  const gaps: Hourly[][] = [];
  const profiles = new Map<number, number[]>();
  for (let i = 1; i < hourly.length - 2; i++) {
    const anchors = hourly.slice(i - 1, i + 3),
      left = anchors[1]!,
      right = anchors[2]!;
    const separation = right.hour - left.hour;
    if (
      separation <= 1 ||
      separation > MAX_BRACKET_HOURS ||
      left.hour - anchors[0]!.hour > MAX_BRACKET_HOURS ||
      anchors[3]!.hour - right.hour > MAX_BRACKET_HOURS
    )
      continue;
    gaps.push(anchors);
    for (const p of anchors) profiles.set(p.hour, []);
  }
  if (!gaps.length) return { hourly, levels, inferred };
  // Compare averaged measurements with averaged predictions at the same sample
  // instants. Retain sampling profiles only for the real anchors around gaps.
  for (const p of samples) {
    if (!Number.isFinite(+p.time) || !Number.isFinite(p.level)) continue;
    const hour = Math.floor(+p.time / HOUR_MS);
    profiles.get(hour)?.push(+p.time - hour * HOUR_MS);
  }
  const predictor = createTidePredictor(constituents),
    predictions = new Map<number, number>();
  const prediction = (time: number) => {
    if (!predictions.has(time))
      predictions.set(
        time,
        predictor.getWaterLevelAtTime({ time: new Date(time) }).level,
      );
    return predictions.get(time)!;
  };
  const binPrediction = (hour: number, profile: number[]) =>
    profile.reduce(
      (sum, offset) => sum + prediction(hour * HOUR_MS + offset),
      0,
    ) / profile.length;
  for (const anchors of gaps) {
    const left = anchors[1]!,
      right = anchors[2]!;
    // A bin residual is an average at its sampling instants, not a point at
    // the integer hour. Fit those averages so changing cadence cannot shift it.
    const coefficients = solveCubic(
      anchors.map((p) => [
        ...samplingMoments(p.hour - left.hour, profiles.get(p.hour)!),
        p.level - binPrediction(p.hour, profiles.get(p.hour)!),
      ]),
    );
    if (!coefficients) continue;
    for (let hour = left.hour + 1; hour < right.hour; hour++) {
      // A missing bin follows its nearer real neighbour's sampling cadence.
      const profile = profiles.get(
        hour - left.hour <= right.hour - hour ? left.hour : right.hour,
      )!;
      const moments = samplingMoments(hour - left.hour, profile);
      const residual = coefficients.reduce(
        (sum, c, degree) => sum + c * moments[degree]!,
        0,
      );
      const level = binPrediction(hour, profile) + residual;
      if (Number.isFinite(level)) {
        levels.set(hour, level);
        inferred.add(hour);
      }
    }
  }
  return { hourly, levels, inferred };
}

function samplingMoments(hour: number, profile: number[]): number[] {
  const moments = [1, 0, 0, 0];
  for (const offset of profile) {
    const x = hour + offset / HOUR_MS;
    for (let degree = 1; degree <= 3; degree++)
      moments[degree]! += x ** degree / profile.length;
  }
  return moments;
}

/** Solve the four bin-average constraints for a cubic residual. */
function solveCubic(rows: number[][]): number[] | undefined {
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!))
        pivot = row;
    if (rows[pivot]![column] === 0) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    for (let row = column + 1; row < 4; row++) {
      const factor = rows[row]![column]! / rows[column]![column]!;
      for (let k = column; k <= 4; k++)
        rows[row]![k]! -= factor * rows[column]![k]!;
    }
  }
  const coefficients = [0, 0, 0, 0];
  for (let row = 3; row >= 0; row--) {
    let value = rows[row]![4]!;
    for (let k = row + 1; k < 4; k++)
      value -= rows[row]![k]! * coefficients[k]!;
    coefficients[row] = value / rows[row]![row]!;
  }
  return coefficients;
}

function calendarMonths({ hourly, levels }: HourlyPreparation): {
  start: number;
  end: number;
  mean: number | undefined;
}[] {
  const first = hourly[0]!.hour,
    last = hourly[hourly.length - 1]!.hour;
  let month = monthStart(first);
  if (month < first) month = shiftMonth(month, 1);
  const months: { start: number; end: number; mean: number | undefined }[] = [];
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

function hourlyWindow(samples: Sample[]): Hourly[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const p of samples) {
    if (!Number.isFinite(+p.time) || !Number.isFinite(p.level)) continue;
    const hour = Math.floor(+p.time / HOUR_MS),
      bucket = buckets.get(hour) ?? { sum: 0, n: 0 };
    bucket.sum += p.level;
    bucket.n++;
    buckets.set(hour, bucket);
  }
  const hourly = [...buckets]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, b]) => ({ hour, level: b.sum / b.n }));
  if (!hourly.length) return [];
  const { start } = resolveEpoch({
    end: new Date(hourly[hourly.length - 1]!.hour * HOUR_MS),
  });
  return hourly.filter((p) => p.hour * HOUR_MS >= +start);
}
function monthStart(hour: number): number {
  const time = new Date(hour * HOUR_MS);
  return Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1) / HOUR_MS;
}
function shiftMonth(hour: number, months: number): number {
  const time = new Date(hour * HOUR_MS);
  return (
    Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + months, 1) / HOUR_MS
  );
}
