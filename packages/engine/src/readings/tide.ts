import type { Extreme, TimelinePoint } from "../harmonics/prediction.js";
import { feetPerMeter, type Units } from "../station.js";
import { interpolate } from "./series.js";

const HOUR = 3_600_000;

/** The fields of a timeline sample that a tide reading needs. */
export type TidePoint = Pick<TimelinePoint, "time" | "level">;

/** The fields of a high or low that a tide reading needs. */
export type TurnPoint = Pick<Extreme, "time" | "level" | "high">;

/** The rate of rise at one sample. */
export interface RatePoint {
  time: Date;
  /** Signed meters per hour: positive rising. */
  rate: number;
}

/** The phase of the tide a reading falls in. */
export type TideState = "High" | "Low" | "Rising" | "Falling";

/** The lead reading at an instant: phase, height, direction and rate. */
export interface TideReading {
  state: TideState;
  /** Height in the timeline's units. */
  level: number;
  /** High or rising, rather than low or falling. */
  up: boolean;
  /** Signed meters per hour. */
  rate: number;
}

/** One rise or fall between adjacent opposite turns, dated at the later turn. */
export interface Swing {
  time: Date;
  range: number;
}

/** The rate of rise at each sample in meters per hour, by central differences, one-sided at the ends. */
export function tideRates(timeline: TidePoint[], units: Units): RatePoint[] {
  const metres = units === "feet" ? 1 / feetPerMeter : 1;
  return timeline.map((p, i) => {
    const a = timeline[Math.max(0, i - 1)];
    const b = timeline[Math.min(timeline.length - 1, i + 1)];
    const hours = (b.time.getTime() - a.time.getTime()) / HOUR;
    return { time: p.time, rate: hours > 0 ? ((b.level - a.level) * metres) / hours : 0 };
  });
}

/** Height at `time`, linearly interpolated; undefined outside the timeline. */
export function levelAt(timeline: TidePoint[], time: Date): number | undefined {
  return interpolate(timeline, time, (p) => p.level);
}

/** Signed rate of rise at `time`, linearly interpolated; undefined outside the samples. */
export function rateAt(rates: RatePoint[], time: Date): number | undefined {
  return interpolate(rates, time, (p) => p.rate);
}

/** Each rising or falling run's fastest sample, when it reaches `floor` meters per hour. */
export function flowPeaks(rates: RatePoint[], floor: number): RatePoint[] {
  const peaks: RatePoint[] = [];
  let run: RatePoint[] = [];
  let direction = 0;
  const finish = () => {
    const peak = run.reduce<RatePoint | undefined>(
      (best, p) => (!best || Math.abs(p.rate) > Math.abs(best.rate) ? p : best),
      undefined,
    );
    if (peak && Math.abs(peak.rate) >= floor) peaks.push(peak);
    run = [];
  };
  for (const p of rates) {
    if (Math.abs(p.rate) < 0.0001) {
      finish();
      direction = 0;
      continue;
    }
    const next = Math.sign(p.rate);
    if (direction !== 0 && next !== direction) finish();
    direction = next;
    run.push(p);
  }
  finish();
  return peaks;
}

/** The lowest and highest sample in [from, to]. */
export function levelRange(
  timeline: TidePoint[],
  from: Date,
  to: Date,
): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const p of timeline) {
    const t = p.time.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    if (p.level < min) min = p.level;
    if (p.level > max) max = p.level;
  }
  return min <= max ? { min, max } : undefined;
}

/**
 * The lead reading at `time`: High or Low within a second of a turn, where
 * the turn's own height reads; otherwise rising toward a high or falling
 * toward a low, using the sampled rate when no later turn is loaded.
 */
export function readTide(
  time: Date,
  timeline: TidePoint[],
  rates: RatePoint[],
  extremes: TurnPoint[],
): TideReading | undefined {
  const level = levelAt(timeline, time);
  if (level === undefined) return undefined;
  // Rates share the timeline's instants, so a level always has one.
  const rate = rateAt(rates, time)!;
  const at = time.getTime();
  const turn = extremes.find((e) => Math.abs(e.time.getTime() - at) <= 1000);
  if (turn) return { state: turn.high ? "High" : "Low", level: turn.level, up: turn.high, rate };
  const up = extremes.find((e) => e.time.getTime() > at)?.high ?? rate >= 0;
  return { state: up ? "Rising" : "Falling", level, up, rate };
}

/** Every rise and fall between adjacent opposite turns, with a run of same-kind turns kept at its true extreme. */
export function swingRanges(extremes: TurnPoint[]): Swing[] {
  const out: Swing[] = [];
  let prev = extremes[0];
  for (const e of extremes.slice(1)) {
    if (e.high === prev.high) {
      // Two lows in a row mean the high between them is missing, so the swing starts from the lower.
      if (!e.high === e.level < prev.level) prev = e;
      continue;
    }
    const [low, high] = prev.high ? [e, prev] : [prev, e];
    prev = e;
    // A subordinate's separate high and low offsets can invert a pair, which is no swing at all.
    if (high.level > low.level) out.push({ time: e.time, range: high.level - low.level });
  }
  return out;
}

/** The height of every swing in {@link swingRanges}. */
export function swingHeights(extremes: TurnPoint[]): number[] {
  return swingRanges(extremes).map((s) => s.range);
}
