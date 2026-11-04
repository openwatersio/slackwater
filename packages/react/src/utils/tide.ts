import type { RatePoint, TideReading } from "@slackwater/engine";
import type { Extreme, Units } from "../types.js";
import { TIDE_RATE_ANCHORS, rampColor, rampInk } from "./color.js";
import type { Stop } from "./scrubber.js";
import { spokenTime } from "./time.js";

const FEET_PER_METRE = 3.2808399;

/** What shows in place of a strip with fewer than two samples. */
export const EMPTY_TIDE_MESSAGE = "No tide predictions for this period.";

/** Below this rate the curve is plain blue; at and above it the line, lead and commentary warn. */
export const FAST_RATE = TIDE_RATE_ANCHORS[0];

export type { RatePoint, TideReading, TideState } from "@slackwater/engine";

/** Every high, low and fast-rate peak, ordered so the pill walks forward. */
export function tideStops(extremes: Extreme[], peaks: RatePoint[] = []): Stop[] {
  return [
    ...extremes.map((e): Stop => ({ time: e.time.getTime(), label: e.high ? "High" : "Low" })),
    ...peaks.map((p): Stop => ({
      time: p.time.getTime(),
      label: p.rate < 0 ? "Fastest fall" : "Fastest rise",
      color: fastTideInk(p.rate),
    })),
  ].sort((a, b) => a.time - b.time);
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

/** Feet to one decimal or meters to two, in the locale's digits; the minus goes only when it rounds to zero. */
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
  const fast =
    reading.state === "Rising" || reading.state === "Falling"
      ? fastTideText(reading.rate, units, locale)
      : undefined;
  const rate = fast
    ? `, ${formatHeight(Math.abs(reading.rate) * (units === "feet" ? FEET_PER_METRE : 1), units, locale)} ${SPOKEN_UNIT[units]} per hour`
    : "";
  return `${reading.state} ${value} ${SPOKEN_UNIT[units]}${rate}, ${spokenTime(time, timeZone, locale)}`;
}
