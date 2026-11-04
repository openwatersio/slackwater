import { levelAt, rateAt, readCurrent, tideRates } from "@slackwater/engine";
import type {
  CurrentEvent,
  CurrentTimelineEntry,
  Extreme,
  StationSummary,
  TimelineEntry,
} from "../types.js";
import type { Directions } from "./current.js";

const HOUR = 3_600_000;

/** One extreme-to-extreme swing: half the M2 semidiurnal period. */
export const SWING_MS = (12.42 / 2) * HOUR;
/** The card's span, weighted toward the forecast: one and a half swings back, two and a half ahead. */
export const CARD_BACK_MS = 1.5 * SWING_MS;
export const CARD_FORWARD_MS = 2.5 * SWING_MS;
/** The small widget's span over the same samples, so now sits a quarter in. */
export const WIDGET_BACK_MS = 0.5 * SWING_MS;
export const WIDGET_FORWARD_MS = 1.5 * SWING_MS;
/** The app's search shows this many results and says when it stopped there. */
export const SEARCH_LIMIT = 60;

const iso = (t: number) => new Date(t).toISOString();

/**
 * What a card loads around `now`: its span measured from the start of the
 * hour, so every card shares queries for an hour and the clock stays inside
 * the data. Extremes reach 30 h on, so a next turn exists to say which way
 * the water is going.
 */
export function cardRange(now: number) {
  const hour = Math.floor(now / HOUR) * HOUR;
  const start = iso(hour - CARD_BACK_MS);
  return {
    timeline: { start, end: iso(hour + HOUR + CARD_FORWARD_MS) },
    extremes: { start, end: iso(hour + 31 * HOUR) },
  };
}

/** The plotted range: the samples inside [from, to], with zero for a current, padded a quarter each way. */
export function cardDomain(
  points: { time: number; value: number }[],
  from: number,
  to: number,
  includesZero: boolean,
): { lo: number; hi: number; lowest: number } {
  const visible = points.filter((p) => p.time >= from && p.time <= to).map((p) => p.value);
  let lo = visible.length ? Math.min(...visible) : 0;
  let hi = visible.length ? Math.max(...visible) : 1;
  if (includesZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const pad = Math.max((hi - lo) * 0.25, 0.001);
  return { lo: lo - pad, hi: hi + pad, lowest: lo };
}

/** A value between samples, held at the first or last sample outside them. */
export function valueAt(points: { time: number; value: number }[], time: number): number {
  let prev = points[0];
  for (const p of points) {
    if (p.time >= time) {
      const span = p.time - prev.time;
      return span > 0 ? prev.value + ((p.value - prev.value) * (time - prev.time)) / span : p.value;
    }
    prev = p;
  }
  return prev.value;
}

export interface TideCardReading {
  /** Height in the timeline's units. */
  level: number;
  rising: boolean;
}

/** The height and trend now, using the sampled rate when no following turn is supplied. */
export function readTideCard(
  timeline: TimelineEntry[],
  extremes: Extreme[],
  now: number,
): TideCardReading | undefined {
  const level = levelAt(timeline, new Date(now));
  if (level === undefined) return undefined;
  // Only the rate's sign is used, so a positive height-unit conversion cannot change the trend.
  const rising =
    extremes.find((e) => e.time.getTime() > now)?.high ??
    rateAt(tideRates(timeline, "meters"), new Date(now))! >= 0;
  return { level, rising };
}

export interface CurrentCardReading {
  /** Signed major-axis knots: positive flood. */
  speed: number;
  /** Full predicted speed in knots. */
  magnitude: number;
  slack: boolean;
  /** Predicted set in degrees true; absent at zero speed or when unknown. */
  direction?: number;
}

export function readCurrentCard(
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  directions: Directions,
  now: number,
): CurrentCardReading | undefined {
  const reading = readCurrent(new Date(now), timeline, events, directions);
  if (!reading) return undefined;
  return {
    speed: reading.speed,
    magnitude: reading.magnitude,
    slack: reading.state === "Slack",
    ...(reading.direction !== undefined && { direction: reading.direction }),
  };
}

/** A distance in kilometers as nautical miles: "1.2 nm" under 10, "14 nm" from 10. */
export function formatNm(km: number, locale?: string): string {
  const nm = km / 1.852;
  const places = nm < 10 ? 1 : 0;
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: false,
  }).format(nm);
  return `${value} nm`;
}

/** Both kinds nearest first, without the station the list is measured from. */
export function mergeNearby<T extends StationSummary>(
  lists: T[][],
  max: number,
  exclude?: { id: string; kind: StationSummary["kind"] },
): T[] {
  return lists
    .flat()
    .filter((s) => !(exclude && s.kind === exclude.kind && s.id === exclude.id))
    .sort(
      (a, b) =>
        (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, max);
}

/**
 * Search results from both kinds in one order, after the app's ranking: a
 * name match before a region match before anything else the API matched.
 * Ties keep each list's own order, alternating between the kinds.
 */
export function rankSearch<T extends StationSummary>(
  query: string,
  lists: T[][],
  limit = SEARCH_LIMIT,
): T[] {
  const q = query.trim().toLowerCase();
  const rank = (s: T) =>
    s.name.toLowerCase().includes(q) ? 0 : (s.region ?? "").toLowerCase().includes(q) ? 1 : 2;
  return lists
    .flatMap((list, k) => list.map((station, i) => ({ station, rank: rank(station), i, k })))
    .sort((a, b) => a.rank - b.rank || a.i - b.i || a.k - b.k)
    .slice(0, limit)
    .map((r) => r.station);
}

/** How far a hanging reading reaches from its dot: the value's center at 30 plus half its line. */
const HANG_REACH = 38;

/**
 * Which way a reading hangs from its dot (+1 down, −1 up): toward the plot
 * middle, the pointer nearest the dot, unless that side runs off the graph,
 * where it would land on the card's name or the axis times.
 */
export function hangToward(dotY: number, high: boolean, plotHeight: number): 1 | -1 {
  if (high) return dotY + HANG_REACH > plotHeight ? -1 : 1;
  return dotY - HANG_REACH < 0 ? 1 : -1;
}

/** Axis times keep 24 px from either edge (the graph bleeds 3 px past the card) and a 48 px gap, so neighbors never print over each other. */
export function thinAxisTimes(times: number[], x: (t: number) => number, width: number): number[] {
  const kept: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const at = x(t);
    if (at < 24 || at > width - 24) continue;
    if (kept.length && at - x(kept[kept.length - 1]) < 48) continue;
    kept.push(t);
  }
  return kept;
}
