import type {
  CurrentTimelineEntry,
  Extreme,
  StationSummary,
  TimelineEntry,
  Units,
} from "../types.js";
import { pinRampColor } from "./color.js";
import { speedAt, formatSpeed, type Directions } from "./current.js";
import { formatHeight, heightUnit, levelAt } from "./tide.js";

/** Readings, gauges, and the predictions behind them start here; below it every pin is a dot. */
export const READING_MIN_ZOOM = 9.5;
/** Names join the readings one tier later, where the locate button lands. */
export const NAME_MIN_ZOOM = 10.5;
export const LOCATE_ZOOM = NAME_MIN_ZOOM;

/** The pin size ramp: 0.4× at zoom 6 to 1.8× at the station zoom, exponential 1.7. */
export const PIN_SCALE = { from: 6, to: 12.5, min: 0.4, max: 1.8, base: 1.7 };

/** One station survives per cell of this many CSS pixels: a touch target. */
export const PIN_CELL = 44;
/** How far past the viewport pins are built, as a fraction of its span. */
export const PIN_VIEWPORT_PAD = 0.5;
/** The gauge's fill steps, 0 through 8: about all a 15 px bar can show. */
export const GAUGE_BUCKETS = 8;
/** The dot's radius, which the selection disc is measured from. */
export const PIN_RADIUS = 5;

/** What colors a pin: a tide's trend, slack, unknown, or a current's ramp color. */
export type PinTone = "rising" | "falling" | "slack" | "unknown" | `#${string}`;

export interface PinState {
  shape: "dot" | "ring" | "arrow" | "gauge";
  tone: PinTone;
  /** The gauge's fill, 0 to `GAUGE_BUCKETS`. */
  bucket?: number;
  /** Degrees true the arrow points: the set the water flows toward. */
  bearing?: number;
  /** "3.2 ft" or "1.8 kn", from `READING_MIN_ZOOM`. */
  reading?: string;
}

export const UNKNOWN_PIN: PinState = { shape: "dot", tone: "unknown" };
/** A station the API can't serve: a hollow ring, steel like unknown. */
export const UNAVAILABLE_PIN: PinState = { shape: "ring", tone: "unknown" };

/** MapLibre's exponential interpolation of the pin scale at `zoom`, clamped at both ends. */
export function pinScale(zoom: number): number {
  const { from, to, min, max, base } = PIN_SCALE;
  const z = Math.min(Math.max(zoom, from), to);
  const t = (base ** (z - from) - 1) / (base ** (to - from) - 1);
  return min + (max - min) * t;
}

/** The same ramp as a style expression, `size` times the scale. */
export function pinScaleExpression(size = 1) {
  const { from, to, min, max, base } = PIN_SCALE;
  return [
    "interpolate",
    ["exponential", base],
    ["zoom"],
    from,
    size * min,
    to,
    size * max,
  ] as const;
}

/** Where `level` sits between the surrounding turns, in buckets; undefined when the range is flat. */
export function gaugeBucket(level: number, prev: number, next: number): number | undefined {
  const lo = Math.min(prev, next);
  const hi = Math.max(prev, next);
  if (hi - lo <= 0.01) return undefined;
  const f = Math.min(1, Math.max(0, (level - lo) / (hi - lo)));
  return Math.round(f * GAUGE_BUCKETS);
}

/**
 * A tide pin: rising toward a high or falling toward a low, and from the
 * reading zoom a gauge between the turns either side of now. Without a next
 * turn the trend is unknown, since a wrong color is worse than steel.
 */
export function tidePinState(
  timeline: TimelineEntry[],
  extremes: Extreme[],
  units: Units,
  now: number,
  detailed: boolean,
  locale?: string,
): PinState {
  const next = extremes.find((e) => e.time.getTime() > now);
  if (!next) return UNKNOWN_PIN;
  const tone = next.high ? "rising" : "falling";
  const level = detailed ? levelAt(timeline, now) : undefined;
  if (level === undefined) return { shape: "dot", tone };
  const prev = extremes.findLast((e) => e.time.getTime() <= now);
  const bucket = prev && gaugeBucket(level, prev.level, next.level);
  const reading = `${formatHeight(level, units, locale)} ${heightUnit(units)}`;
  return bucket === undefined
    ? { shape: "dot", tone, reading }
    : { shape: "gauge", tone, bucket, reading };
}

/**
 * A current pin: an arrow toward the set, green at or under the slack
 * threshold and otherwise the lifted ramp at its speed. A station with no
 * published set for this direction is a dot in the same color.
 */
export function currentPinState(
  timeline: CurrentTimelineEntry[],
  directions: Directions,
  threshold: number,
  now: number,
  detailed: boolean,
  locale?: string,
): PinState {
  const speed = speedAt(timeline, now);
  if (speed === undefined) return UNKNOWN_PIN;
  const tone: PinTone =
    Math.abs(speed) <= threshold ? "slack" : (pinRampColor(Math.abs(speed)) as PinTone);
  const bearing = speed >= 0 ? directions.flood : directions.ebb;
  const reading = detailed ? `${formatSpeed(speed, locale)} kn` : undefined;
  return {
    shape: bearing === undefined ? "dot" : "arrow",
    tone,
    ...(bearing !== undefined && { bearing }),
    ...(reading && { reading }),
  };
}

/** A station as the map lists it; a current listing also says whether it can be served. */
export type MapStation = StationSummary & { predictions?: boolean };

/** Tide and current ids are separate namespaces. */
export function stationKey(station: Pick<StationSummary, "kind" | "id">): string {
  return `${station.kind}:${station.id}`;
}

/**
 * Which station keeps a cell, lowest first: a harmonic station before a
 * subordinate, and a station that can't be served after both. The listings
 * carry no amplitudes, so the app's larger-signal-first tiebreak isn't applied.
 */
export function pinRank(station: MapStation): number {
  if (station.predictions === false) return 30;
  return station.type === "subordinate" ? 10 : 0;
}

/** A camera box in degrees; `west > east` means it wraps the antimeridian. */
export interface PinBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** MapLibre's bounds as a box, with longitudes past ±180 wrapped back. */
export function boxFromBounds(west: number, south: number, east: number, north: number): PinBox {
  if (east - west >= 360) return { south, west: -180, north, east: 180 };
  return { south, west: wrap(west), north, east: wrap(east) };
}

function lonSpan(box: PinBox): number {
  const span = box.east - box.west;
  return span < 0 ? span + 360 : span;
}

export function boxContains(box: PinBox, lat: number, lon: number): boolean {
  if (lat < box.south || lat > box.north) return false;
  return box.west <= box.east
    ? lon >= box.west && lon <= box.east
    : lon >= box.west || lon <= box.east;
}

/** Grown by `fraction` of its own span on every side, so a small pan reuses what is loaded. */
export function padBox(box: PinBox, fraction: number): PinBox {
  const dLat = (box.north - box.south) * fraction;
  const dLon = lonSpan(box) * fraction;
  const south = Math.max(-90, box.south - dLat);
  const north = Math.min(90, box.north + dLat);
  if (lonSpan(box) + dLon * 2 >= 360) return { south, west: -180, north, east: 180 };
  return { south, west: wrap(box.west - dLon), north, east: wrap(box.east + dLon) };
}

/** True when `outer` holds all of `inner`, comparing longitudes as arcs from `outer`'s west edge. */
export function boxCovers(outer: PinBox, inner: PinBox): boolean {
  if (inner.south < outer.south || inner.north > outer.north) return false;
  if (lonSpan(outer) >= 360) return true;
  const start = (((inner.west - outer.west) % 360) + 360) % 360;
  return start + lonSpan(inner) <= lonSpan(outer);
}

/** The listing's `bbox`: a box across the antimeridian asks for its whole latitude band, since the API's boxes don't wrap. */
export function listingBbox(box: PinBox): string {
  const [west, east] = box.west <= box.east ? [box.west, box.east] : [-180, 180];
  return [west, box.south, east, box.north].map((n) => Number(n.toFixed(4))).join(",");
}

/**
 * The stations a camera draws: inside the box, then the best-ranked one per
 * 44 px cell, so the pins (and the predictions behind them) are bounded by
 * screen area. Cells are web-mercator squares on MapLibre's 512 px tiles.
 * Pinned stations in the box always survive. Stations that can't be served appear only
 * from the name zoom.
 */
export function visibleStations<T extends MapStation>(
  stations: T[],
  box: PinBox,
  zoom: number,
  pinned: string[] = [],
): T[] {
  const cellLon = (PIN_CELL * 360) / (512 * 2 ** zoom);
  const midLat = (box.south + box.north) / 2;
  const cellLat = Math.max(cellLon * Math.cos((midLat * Math.PI) / 180), 1e-9);
  const best = new Map<string, { station: T; rank: number }>();
  const pinnedInBox: T[] = [];
  for (const station of stations) {
    if (!boxContains(box, station.latitude, station.longitude)) continue;
    if (pinned.includes(stationKey(station))) pinnedInBox.push(station);
    else if (station.predictions === false && zoom < NAME_MIN_ZOOM) continue;
    const cell = `${Math.floor(station.longitude / cellLon)},${Math.floor(station.latitude / cellLat)}`;
    const rank = pinRank(station);
    const held = best.get(cell);
    if (held && (held.rank < rank || (held.rank === rank && held.station.id < station.id)))
      continue;
    best.set(cell, { station, rank });
  }
  const kept = [...best.values()].map((b) => b.station);
  return [...kept, ...pinnedInBox.filter((s) => !kept.includes(s))];
}
