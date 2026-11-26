import type { Sample } from "./datum.js";

/**
 * A tabulated high or low water. `higher` marks a higher high or lower low water, the one of
 * each tidal day's pair that MHHW or MLLW averages.
 */
export interface TideTurn extends Sample {
  high: boolean;
  higher: boolean;
}

// The constants and rules below follow NOAA CO-OPS's Tidal Analysis Datum Calculator (TADC),
// described in NOAA Tech. Rpt. NOS CO-OPS 085 §2.2, as its code does at
// https://github.com/NOAA-CO-OPS/CO-OPS-Tidal-Analysis-Datum-Calculator/tree/04836aa
// (`tides.py` for the checks, picks and designations, `run.py` for the filter and day count).
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
// 6th order Butterworth low-pass at 4 cycles per day.
const FILTER_ORDER = 6;
const CUTOFF_CYCLES_PER_HOUR = 4 / 24;
// Hourly values mirrored past each end before filtering, so the filter's start-up transient
// dies out before the data.
const PAD_HOURS = 96;
// A high and the neighbouring low closer than either bound are not a tide (Hicks 1980).
const MIN_TURN_SEPARATION_MS = 2 * HOUR_MS;
const MIN_TURN_RANGE = 0.03;
// Centimetre-rounded heights 3 cm apart differ by 0.03 give or take float noise; count them as 3 cm.
const RANGE_TOLERANCE = 1e-9;
// Below this sampling interval a turn's height comes from a cubic fit, above it from the
// extreme observation within ±30 minutes.
const FIT_MAX_INTERVAL_MS = 15 * MINUTE_MS;
const EXTREME_HALF_WINDOW_MS = 30 * MINUTE_MS;
// The cubic fit's search window, before it narrows with the local range.
export const FIT_SEARCH_HALF_WINDOW_MS = 3 * HOUR_MS + 15 * MINUTE_MS;
// More tides than this per day designate higher highs and lower lows in pairs (EXHL), fewer
// by stepping a tidal day at a time (DIUR).
const SEMIDIURNAL_TIDES_PER_DAY = 3;
const DIURNAL_STEP_MS = 25 * HOUR_MS;
const DIURNAL_FIRST_SEARCH_MS = 13 * HOUR_MS;

type Turn = Sample & { high: boolean };

/**
 * High and low waters tabulated by TADC's method: low-pass the series at 4 cycles per day,
 * take the filtered series' turning points, drop turns that fail the 2-hour and 0.03 m
 * criteria, read each remaining turn's time and height from the observations around it, and
 * designate the higher highs and lower lows.
 *
 * `hourly` is a gap-free series of hourly heights, each at the instant it represents, which the
 * filter needs; TADC filters the observations at their own interval instead, which needs
 * regular sampling. `observations` are the samples at their own cadence, sorted by time with
 * no repeated instants, and must not be empty.
 */
export function tabulateTurns(
  hourly: readonly Sample[],
  observations: readonly Sample[],
): TideTurn[] {
  const filtered = lowPass(hourly.map((p) => p.level));
  const kept = checkTides(
    turningPoints(filtered).map(({ index, high }) => ({
      time: +hourly[index]!.time,
      level: hourly[index]!.level,
      high,
    })),
  );
  const picked = kept.map((turn) => ({
    ...pick(observations, turn.time, turn.high),
    high: turn.high,
  }));
  const first = +hourly[0]!.time;
  // TADC adds one 6-minute interval to the span when it counts tides per day.
  const days = (+hourly[hourly.length - 1]!.time - first + 6 * MINUTE_MS) / (24 * HOUR_MS);
  return designate(picked, picked.length / days > SEMIDIURNAL_TIDES_PER_DAY, first);
}

/** Zero-phase Butterworth low-pass: the filter run forward, then backward, over padded data. */
function lowPass(levels: readonly number[]): number[] {
  const pad = Math.min(PAD_HOURS, levels.length - 1);
  // Odd reflection keeps the level and slope continuous at each end.
  const first = levels[0]!;
  const last = levels[levels.length - 1]!;
  const padded = [
    ...Array.from({ length: pad }, (_, i) => 2 * first - levels[pad - i]!),
    ...levels,
    ...Array.from({ length: pad }, (_, i) => 2 * last - levels[levels.length - 2 - i]!),
  ].map((level) => level - first);
  const sections = butterworth(FILTER_ORDER, CUTOFF_CYCLES_PER_HOUR);
  const forward = cascade(sections, padded);
  const backward = cascade(sections, forward.reverse()).reverse();
  return backward.slice(pad, pad + levels.length).map((level) => level + first);
}

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** A digital Butterworth low-pass as second-order sections, by the bilinear transform. */
function butterworth(order: number, cutoff: number): Biquad[] {
  // Pre-warped analog cutoff for a sample rate of 1.
  const k = Math.tan(Math.PI * cutoff);
  const sections: Biquad[] = [];
  for (let pair = 0; pair < order / 2; pair++) {
    // Each conjugate pair of analog poles gives s² + q·s + 1, q = 2 sin(θ).
    const q = 2 * Math.sin((Math.PI * (2 * pair + 1)) / (2 * order));
    const norm = k * k + q * k + 1;
    sections.push([
      (k * k) / norm,
      (2 * k * k) / norm,
      (k * k) / norm,
      (2 * (k * k - 1)) / norm,
      (k * k - q * k + 1) / norm,
    ]);
  }
  return sections;
}

/** Run a series through each second-order section in turn (direct form II transposed). */
function cascade(sections: readonly Biquad[], input: readonly number[]): number[] {
  let signal = [...input];
  for (const [b0, b1, b2, a1, a2] of sections) {
    let z1 = 0;
    let z2 = 0;
    signal = signal.map((x) => {
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      return y;
    });
  }
  return signal;
}

/** Strict local maxima and minima of the filtered series, in time order. */
function turningPoints(filtered: readonly number[]): { index: number; high: boolean }[] {
  const turns: { index: number; high: boolean }[] = [];
  for (let i = 1; i < filtered.length - 1; i++) {
    const [before, value, after] = [filtered[i - 1]!, filtered[i]!, filtered[i + 1]!];
    if (value > before && value > after) turns.push({ index: i, high: true });
    else if (value < before && value < after) turns.push({ index: i, high: false });
  }
  return turns;
}

/**
 * TADC's walk over the candidate turns, comparing each with the last one kept: a turn of the
 * same kind within 2 hours is dropped, and a high and low within 2 hours or 0.03 m of each other
 * are both dropped, the walk resuming after them. Times are epoch milliseconds.
 */
export function checkTides<T extends { time: number; level: number; high: boolean }>(
  turns: readonly T[],
): T[] {
  const removed = new Uint8Array(turns.length);
  let t1 = 0;
  let t2 = 1;
  while (t2 < turns.length) {
    const a = turns[t1]!;
    const b = turns[t2]!;
    const close = b.time - a.time < MIN_TURN_SEPARATION_MS;
    if (close && a.high === b.high) {
      removed[t2] = 1;
      t2++;
    } else if (close || Math.abs(b.level - a.level) < MIN_TURN_RANGE - RANGE_TOLERANCE) {
      removed[t1] = removed[t2] = 1;
      t1 = t2 + 1;
      t2 = t1 + 1;
    } else {
      t1 = t2;
      t2 = t1 + 1;
    }
  }
  return turns.filter((_, i) => !removed[i]);
}

/** A turn's time and height from the observations around `time`, of which there are two or more. */
export function pick(observations: readonly Sample[], time: number, high: boolean): Sample {
  const center = nearest(observations, time);
  // TADC reads the interval after the turn's sample; the last sample has only one before it.
  const neighbour = observations[center + 1] ?? observations[center - 1]!;
  const interval = Math.abs(+neighbour.time - +observations[center]!.time);
  return (
    (interval < FIT_MAX_INTERVAL_MS && polyFit(observations, center, high)) ||
    extreme(observations, center, high)
  );
}

/** The extreme observation within 30 minutes of `observations[center]`. */
function extreme(observations: readonly Sample[], center: number, high: boolean): Sample {
  const { from, to } = span(observations, center, EXTREME_HALF_WINDOW_MS);
  let best = observations[center]!;
  for (let i = from; i <= to; i++) {
    const level = observations[i]!.level;
    if (high ? level > best.level : level < best.level) best = observations[i]!;
  }
  return best;
}

/**
 * TADC's PolyFit pick: fit a cubic to the observations in a window around the turn, 6.5 h wide
 * where the local range is 0.5 m and narrowing to 2.5 h at 1 m or more, and take the fitted
 * curve's extreme at an observation's time. Undefined when the fit has too few points.
 */
function polyFit(
  observations: readonly Sample[],
  center: number,
  high: boolean,
): Sample | undefined {
  const search = span(observations, center, FIT_SEARCH_HALF_WINDOW_MS);
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = search.from; i <= search.to; i++) {
    lowest = Math.min(lowest, observations[i]!.level);
    highest = Math.max(highest, observations[i]!.level);
  }
  // TADC treats a range under 0.5 m like one of 1 m.
  const range = highest - lowest < 0.5 ? 1 : Math.min(highest - lowest, 1);
  const width = 6.5 * HOUR_MS - (range - 0.5) * 480 * MINUTE_MS;
  const { from, to } = span(observations, center, width / 2);
  if (to - from + 1 < 4) return undefined;

  // x in hours from the center keeps the normal equations well conditioned.
  const origin = +observations[center]!.time;
  const sums = new Array<number>(7).fill(0);
  const rhs = new Array<number>(4).fill(0);
  for (let i = from; i <= to; i++) {
    const x = (+observations[i]!.time - origin) / HOUR_MS;
    for (let k = 0; k <= 6; k++) sums[k]! += x ** k;
    for (let k = 0; k <= 3; k++) rhs[k]! += observations[i]!.level * x ** k;
  }
  const [c0, c1, c2, c3] = solve(
    Array.from({ length: 4 }, (_, r) => [...sums.slice(r, r + 4), rhs[r]!]),
  ) as [number, number, number, number];

  let best: Sample | undefined;
  for (let i = from; i <= to; i++) {
    const x = (+observations[i]!.time - origin) / HOUR_MS;
    const level = c0 + c1 * x + c2 * x ** 2 + c3 * x ** 3;
    if (!best || (high ? level > best.level : level < best.level))
      best = { time: observations[i]!.time, level };
  }
  return best;
}

/**
 * Gaussian elimination on an augmented n×(n+1) system. Normal equations are symmetric and
 * positive definite, so they need no pivoting.
 */
function solve(rows: number[][]): number[] {
  const size = rows.length;
  for (let column = 0; column < size; column++) {
    for (let row = column + 1; row < size; row++) {
      const factor = rows[row]![column]! / rows[column]![column]!;
      for (let k = column; k <= size; k++) rows[row]![k]! -= factor * rows[column]![k]!;
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let value = rows[row]![size]!;
    for (let k = row + 1; k < size; k++) value -= rows[row]![k]! * solution[k]!;
    solution[row] = value / rows[row]![row]!;
  }
  return solution;
}

/** Index range of the observations within `halfWindow` of `observations[center]`, inclusive. */
function span(observations: readonly Sample[], center: number, halfWindow: number) {
  const time = +observations[center]!.time;
  let from = center;
  let to = center;
  while (from > 0 && time - +observations[from - 1]!.time <= halfWindow) from--;
  while (to < observations.length - 1 && +observations[to + 1]!.time - time <= halfWindow) to++;
  return { from, to };
}

/** Index of the observation nearest in time to `time`, from observations sorted by time. */
function nearest(observations: readonly Sample[], time: number): number {
  let lo = 0;
  let hi = observations.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (+observations[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && time - +observations[lo - 1]!.time <= +observations[lo]!.time - time
    ? lo - 1
    : lo;
}

/** Mark the higher highs and lower lows, by TADC's EXHL for a semidiurnal tide, else DIUR. */
function designate(turns: readonly Turn[], semidiurnal: boolean, start: number): TideTurn[] {
  const result: TideTurn[] = turns.map((turn) => ({ ...turn, higher: false }));
  for (const high of [true, false]) {
    const indices = result.flatMap((turn, i) => (turn.high === high ? [i] : []));
    const times = indices.map((i) => +result[i]!.time);
    // A low's "higher" one is the lower, so compare depths.
    const values = indices.map((i) => (high ? result[i]!.level : -result[i]!.level));
    const marked = semidiurnal ? exhl(values) : diur(times, values, start);
    for (const j of marked) result[indices[j]!]!.higher = true;
  }
  return result;
}

/** TADC's EXHL: of each consecutive pair of highs (or lows), the more extreme is the higher. */
export function exhl(values: readonly number[]): number[] {
  const marked: number[] = [];
  for (let i = 0; i + 1 < values.length; i += 2)
    marked.push(values[i]! >= values[i + 1]! ? i : i + 1);
  return marked;
}

/**
 * TADC's DIUR, for tides with mostly one high and one low a day: from the most extreme tide in
 * the first 13 hours, step 25 hours at a time and mark the most extreme tide around each step.
 * `values` are heights for highs and depths for lows, so larger is always more extreme.
 */
export function diur(times: readonly number[], values: readonly number[], start: number): number[] {
  const n = times.length;
  const marked = new Set<number>();
  // The index of the most extreme tide in [t1, t2], or -1 when there is none.
  // The first index whose time is at or after `time`, or n; the times are sorted.
  const from = (time: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const most = (t1: number, t2: number) => {
    let index = -1;
    for (let i = from(t1); i < n && times[i]! <= t2; i++)
      if (index < 0 || values[i]! > values[index]!) index = i;
    return index;
  };
  // The index of the tide nearest `time`, which always lies after the first tide.
  const near = (time: number) => {
    const i = Math.min(from(time), n - 1);
    return i > 0 && time - times[i - 1]! < times[i]! - time ? i - 1 : i;
  };

  let tide1 = Math.max(most(start, start + DIURNAL_FIRST_SEARCH_MS), 0);
  let point1 = times[tide1]!;
  while (tide1 < n - 1) {
    let index = near(point1 + DIURNAL_STEP_MS);
    if (times[index] === point1) index = Math.min(index + 1, n - 1);
    const point2 = times[index]!;
    index = near(point2 + DIURNAL_STEP_MS);
    if (times[index] === point2) index = Math.min(index + 1, n - 1);
    const point3 = times[index]!;
    // At the last tide the step can't advance; TADC would loop.
    if (point2 <= point1) break;
    // The window always holds point2, so a tide is always found.
    const tide2 = most(point1 + (point2 - point1) / 2, point2 + (point3 - point2) / 2);
    const timeC = times[tide1]! + (times[tide2]! - times[tide1]!) / 2;
    // Uneven steps can put timeC before point1, leaving no tide to mark; TADC's Python reads
    // that as the last tide and marks it.
    const first = most(point1, timeC);
    if (first >= 0) marked.add(most(times[first]!, timeC));
    point1 = point2;
    tide1 = tide2;
  }
  return [...marked].sort((a, b) => a - b);
}
