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

/** Where `value` sits among `values`, 0…1, ties counting as below; undefined with fewer than two to rank against. */
export function peakRank(value: number, values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  return values.filter((v) => v <= value).length / values.length;
}

/** Every rise and fall between adjacent opposite turns, with a run of same-kind turns kept at its true extreme. */
export function swingHeights(extremes: Extreme[]): number[] {
  const out: number[] = [];
  let prev = extremes[0];
  for (const e of extremes.slice(1)) {
    if (e.high === prev.high) {
      // Two lows in a row mean the high between them is missing, so the swing starts from the lower.
      if (e.low === e.level < prev.level) prev = e;
      continue;
    }
    const [low, high] = prev.high ? [e, prev] : [prev, e];
    prev = e;
    // A subordinate's separate high and low offsets can invert a pair, which is no swing at all.
    if (high.level > low.level) out.push(high.level - low.level);
  }
  return out;
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

/** One direction's maxima as unsigned speeds, so floods rank against floods and ebbs against ebbs. */
export function maxSpeeds(events: CurrentEvent[], kind: "maxFlood" | "maxEbb"): number[] {
  return events.filter((e) => e.kind === kind).map((e) => Math.abs(e.speed));
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
    value: `${formatSpeed(e.speed, locale)} kn`,
    caption,
    marked,
  };
}
