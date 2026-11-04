import { maxSpeeds, peakRank, swingRanges } from "@slackwater/engine";
import type { CurrentEvent, Extreme, Units } from "../types.js";
import { formatSpeed } from "./current.js";
import { formatHeight, heightUnit } from "./tide.js";
import { addDays, chartTime, startOfDay } from "./time.js";

/** Calendar days either side of the opening day that a tile's reading ranks against. */
export const HALF_WINDOW_DAYS = 15;

/** The top tenth is about one spring series a fortnight; a mark shown more often says nothing. */
export const MARK_THRESHOLD = 0.9;

/** One summary tile's text. `marked` adds the span glyph beside the label. */
export interface TileContent {
  label: string;
  value: string;
  caption: string;
  marked?: boolean;
}

/** The station-local days from fifteen before the day containing `time` to fifteen after it. */
export function fortnightWindow(time: number, timeZone: string): { start: string; end: string } {
  const day = startOfDay(time, timeZone);
  return {
    start: new Date(addDays(day, -HALF_WINDOW_DAYS, timeZone)).toISOString(),
    end: new Date(addDays(day, HALF_WINDOW_DAYS, timeZone)).toISOString(),
  };
}

export function outlookWeek(anchor: number, time: number, timezone: string): number {
  const day = startOfDay(time, timezone);
  if (day < anchor) return addDays(day, -4, timezone);
  return day < addDays(anchor, 5, timezone) ? anchor : day;
}

/** A full outlook week, with surrounding turns to measure its first and last swings. */
export function outlookWindow(week: number, timezone: string): { start: string; end: string } {
  return {
    start: new Date(addDays(week, -1, timezone)).toISOString(),
    end: new Date(addDays(week, 8, timezone)).toISOString(),
  };
}

export function dailySwingRanges(
  extremes: Extreme[],
  start: number,
  end: number,
  anchor: number,
  timezone: string,
): { day: number; range?: number }[] {
  const peaks = new Map<number, number>();
  for (const swing of swingRanges(extremes)) {
    const day = startOfDay(swing.time.getTime(), timezone);
    if (day < start || addDays(day, 1, timezone) > end) continue;
    peaks.set(day, Math.max(peaks.get(day) ?? 0, swing.range));
  }
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(anchor, i, timezone);
    return { day, range: peaks.get(day) };
  });
}

/** The Range tile: the swing from the turn at or behind `time` to the one ahead, ranked among the fortnight's swings. */
export function rangeTile(
  extremes: Extreme[],
  time: number,
  swings: number[] | undefined,
  units: Units,
  locale?: string,
): TileContent | undefined {
  const prev = extremes.findLast((e) => e.time.getTime() <= time);
  const next = extremes.find((e) => e.time.getTime() > time);
  if (!prev || !next) return undefined;
  const swing = Math.abs(next.level - prev.level);
  const rank = swings && peakRank(swing, swings);
  const marked = rank !== undefined && rank >= MARK_THRESHOLD;
  return {
    label: "Range",
    value: `${formatHeight(swing, units, locale)} ${heightUnit(units)}`,
    caption: !marked
      ? prev.low
        ? "low to high"
        : "high to low"
      : rank >= 1
        ? "the fortnight's biggest"
        : "beyond normal here",
    marked,
  };
}

/** The Next max tile: the first maximum after `time`, ranked within its own direction's fortnight. */
export function nextMaxTile(
  events: CurrentEvent[],
  time: number,
  fortnight: CurrentEvent[] | undefined,
  timeZone: string,
  locale?: string,
): TileContent | undefined {
  const e = events.find(
    (e): e is CurrentEvent & { kind: "maxFlood" | "maxEbb" } =>
      e.kind !== "slack" && e.time.getTime() > time,
  );
  if (!e) return undefined;
  const flood = e.kind === "maxFlood";
  const rank = fortnight && peakRank(Math.abs(e.speed), maxSpeeds(fortnight, e.kind));
  const marked = rank !== undefined && rank >= MARK_THRESHOLD;
  const at = chartTime(e.time.getTime(), timeZone, locale);
  // The time is what a reader acts on, so the standing rides on the direction word instead.
  const caption = !marked
    ? `${flood ? "Flood" : "Ebb"} at ${at}`
    : `${rank >= 1 ? "Hardest" : "Strong"} ${flood ? "flood" : "ebb"} · ${at}`;
  return {
    label: "Next max",
    value: `${formatSpeed(e.speed, locale)} kn axis`,
    caption,
    marked,
  };
}
