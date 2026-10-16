import type { Extreme, TimelineEntry, Units } from "../types.js";
import { TIDE_RATE_ANCHORS, rampColor, rampInk } from "./color.js";
import { interpolate, type Stop } from "./scrubber.js";
import { spokenTime } from "./time.js";

const HOUR = 3_600_000;
const FEET_PER_METRE = 3.2808399;

/** What shows in place of a strip with fewer than two samples. */
export const EMPTY_TIDE_MESSAGE = "No tide predictions for this period.";

/** Below this rate the curve is plain blue; at and above it the line, lead and commentary warn. */
export const FAST_RATE = TIDE_RATE_ANCHORS[0];

export interface RatePoint {
  time: Date;
  /** Signed metres per hour: positive rising. */
  rate: number;
}

/** The rate of rise at each sample in metres per hour, by central differences, one-sided at the ends. */
export function tideRates(timeline: TimelineEntry[], units: Units): RatePoint[] {
  const metres = units === "feet" ? 1 / FEET_PER_METRE : 1;
  return timeline.map((p, i) => {
    const a = timeline[Math.max(0, i - 1)];
    const b = timeline[Math.min(timeline.length - 1, i + 1)];
    const hours = (b.time.getTime() - a.time.getTime()) / HOUR;
    return { time: p.time, rate: hours > 0 ? ((b.level - a.level) * metres) / hours : 0 };
  });
}

export function levelAt(timeline: TimelineEntry[], time: number): number | undefined {
  return interpolate(timeline, time, (p) => p.level);
}

export function rateAt(rates: RatePoint[], time: number): number | undefined {
  return interpolate(rates, time, (p) => p.rate);
}

/** Each rising or falling run's fastest sample, when it reaches the fast-tide floor. */
export function flowPeaks(rates: RatePoint[]): RatePoint[] {
  const peaks: RatePoint[] = [];
  let run: RatePoint[] = [];
  let direction = 0;
  const finish = () => {
    const peak = run.reduce<RatePoint | undefined>(
      (best, p) => (!best || Math.abs(p.rate) > Math.abs(best.rate) ? p : best),
      undefined,
    );
    if (peak && Math.abs(peak.rate) >= FAST_RATE) peaks.push(peak);
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

/** The commentary's water stops: every high and low. */
export function tideStops(extremes: Extreme[]): Stop[] {
  return extremes.map((e) => ({ time: e.time.getTime(), label: e.high ? "High" : "Low" }));
}

/** The plot's vertical mapping: heights centered on `mid`, reaching `span` either side. */
export interface TideScale {
  mid: number;
  span: number;
}

/** The fit around a range's midpoint, padded 6% with a nonzero floor. */
export function fitScale(min: number, max: number): TideScale {
  return { mid: (min + max) / 2, span: Math.max((max - min) / 2, 0.01) * 1.06 };
}

/** The lowest and highest sample in [from, to]. */
export function levelRange(
  timeline: TimelineEntry[],
  from: number,
  to: number,
): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const p of timeline) {
    const t = p.time.getTime();
    if (t < from || t > to) continue;
    if (p.level < min) min = p.level;
    if (p.level > max) max = p.level;
  }
  return min <= max ? { min, max } : undefined;
}

/**
 * The scale the strip should hold for the visible range: `held` while the
 * curve fits comfortably, a fresh fit once it reaches past 97% of the held
 * span or would fill less than 65% of it. A fresh fit reaches 94%, inside
 * both, so adopting one is a fixed point.
 */
export function governScale(held: TideScale, min: number, max: number): TideScale {
  const reach = Math.max(max - held.mid, held.mid - min) / held.span;
  const target = fitScale(min, max);
  return reach > 0.97 || target.span < 0.65 * held.span ? target : held;
}

/** Smoothstep, exact at both ends so a glide lands on its target. */
export function eased(t: number): number {
  const f = Math.max(0, Math.min(1, t));
  return f * f * (3 - 2 * f);
}

export function lerpScale(a: TideScale, b: TideScale, f: number): TideScale {
  return { mid: a.mid + (b.mid - a.mid) * f, span: a.span + (b.span - a.span) * f };
}

/** The tide line's color at a rate: blue below the fast-tide floor, the ramp from it. */
export function rateColor(rate: number): string | undefined {
  return Math.abs(rate) < FAST_RATE ? undefined : rampColor(rate, TIDE_RATE_ANCHORS);
}

/** The fast-tide ink for the lead glyph and the commentary; undefined while the tide is ordinary. */
export function fastTideInk(rate: number): string | undefined {
  return Math.abs(rate) < FAST_RATE ? undefined : rampInk(rate, TIDE_RATE_ANCHORS);
}

export type TideState = "High" | "Low" | "Rising" | "Falling";

export interface TideReading {
  state: TideState;
  /** Height in the timeline's units. */
  level: number;
  /** High or rising, rather than low or falling. */
  up: boolean;
  /** Signed metres per hour. */
  rate: number;
}

/**
 * The lead reading at `time`: High or Low within a second of a turn, where
 * the turn's own height reads; otherwise rising toward a high or falling
 * toward a low, and rising when no later turn is loaded.
 */
export function readTide(
  time: number,
  timeline: TimelineEntry[],
  rates: RatePoint[],
  extremes: Extreme[],
): TideReading | undefined {
  const level = levelAt(timeline, time);
  if (level === undefined) return undefined;
  // Rates share the timeline's instants, so a level always has one.
  const rate = rateAt(rates, time)!;
  const turn = extremes.find((e) => Math.abs(e.time.getTime() - time) <= 1000);
  if (turn) return { state: turn.high ? "High" : "Low", level: turn.level, up: turn.high, rate };
  const up = extremes.find((e) => e.time.getTime() > time)?.high ?? true;
  return { state: up ? "Rising" : "Falling", level, up, rate };
}

/** Feet to one decimal or metres to two, in the locale's digits; the minus goes only when it rounds to zero. */
export function formatHeight(value: number, units: Units, locale?: string): string {
  const places = units === "feet" ? 1 : 2;
  const n = Math.abs(value) < 0.5 / 10 ** places ? 0 : value;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: false,
  }).format(n);
}

export function heightUnit(units: Units): string {
  return units === "feet" ? "ft" : "m";
}

const SPOKEN_UNIT: Record<Units, string> = { feet: "feet", meters: "metres" };

/** "Rising 0.60 m/hr" while the water moves at least 0.6 m/hr, formatted like a height per hour. */
export function fastTideText(rate: number, units: Units, locale?: string): string | undefined {
  if (Math.abs(rate) < FAST_RATE) return undefined;
  const value = formatHeight(
    Math.abs(rate) * (units === "feet" ? FEET_PER_METRE : 1),
    units,
    locale,
  );
  return `${rate < 0 ? "Falling" : "Rising"} ${value} ${heightUnit(units)}/hr`;
}

/** The reading a screen reader hears: "Rising 1.2 feet, Oct 14, 4:22 PM PDT". */
export function spokenTide(
  reading: TideReading,
  time: number,
  timeZone: string,
  units: Units,
  locale?: string,
): string {
  const value = formatHeight(reading.level, units, locale);
  return `${reading.state} ${value} ${SPOKEN_UNIT[units]}, ${spokenTime(time, timeZone, locale)}`;
}
