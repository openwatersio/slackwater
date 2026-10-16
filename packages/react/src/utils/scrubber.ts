import type { Day } from "./time.js";

const HOUR = 3_600_000;

/** Constant time scale in CSS pixels per hour; never stretched on wide screens. */
export const PX_PER_HOUR = 18;
/** One logical unit of time: 200 seconds at 18 units per hour. */
export const UNIT_MS = HOUR / PX_PER_HOUR;
/** Within one unit of now the selection is home and the Now pill hides. */
export const NEAR_NOW_MS = UNIT_MS;
/** The magnet's strict capture radius: 4.5 units, 15 minutes. */
export const MAGNET_MS = 4.5 * UNIT_MS;
/** Half the widest label, so no mark near a loaded edge draws cut by it. */
export const EDGE_MS = 1.5 * HOUR;
/** Event times closer than 64 units to the last one kept are omitted. */
export const LABEL_GAP_MS = 64 * UNIT_MS;
/** Longer programmatic moves land directly rather than compress weeks into a glide. */
export const LONG_TRAVEL_MS = 7 * 24 * HOUR;

/** The target strictly within the capture radius of `time` nearest to it; the earlier on a tie. */
export function magnetTarget(targets: number[], time: number): number | undefined {
  let best: number | undefined;
  for (const t of targets) {
    const d = Math.abs(t - time);
    if (d < MAGNET_MS && (best === undefined || d < Math.abs(best - time))) best = t;
  }
  return best;
}

/** The first target more than a second after `time`, or the last more than a second before it. */
export function adjacentTarget(
  targets: number[],
  time: number,
  forward: boolean,
): number | undefined {
  return forward
    ? targets.find((t) => t > time + 1000)
    : [...targets].reverse().find((t) => t < time - 1000);
}

/** `time` clamped to the center times a strip of `viewport` ms can scroll to. */
export function reachable(time: number, start: number, end: number, viewport: number): number {
  const lo = start + viewport / 2;
  const hi = Math.max(lo, end - viewport / 2);
  return Math.min(hi, Math.max(lo, time));
}

/** Whether a programmatic move rides the strip to its destination or lands directly. */
export function rides(from: number, to: number, reduceMotion: boolean): boolean {
  const travel = Math.abs(to - from);
  return !reduceMotion && travel >= UNIT_MS / 2 && travel <= LONG_TRAVEL_MS;
}

/** Items far enough from both loaded edges to draw whole. */
export function awayFromEdges<T extends { time: number }>(
  items: T[],
  start: number,
  end: number,
): T[] {
  return items.filter((i) => i.time - start >= EDGE_MS && end - i.time >= EDGE_MS);
}

/** Sorted labels, keeping the earlier of any two closer than the label gap. */
export function thinLabels<T extends { time: number }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const prev = kept[kept.length - 1];
    if (!prev || item.time - prev.time >= LABEL_GAP_MS) kept.push(item);
  }
  return kept;
}

/** The day-row anchor nearest `time`: a sun event to center, or a date (which wins ties). */
export function dayRowHit(
  sun: number[],
  dates: number[],
  time: number,
): { time: number; sun: boolean } | undefined {
  let best: { time: number; sun: boolean } | undefined;
  const consider = (t: number, isSun: boolean) => {
    const d = Math.abs(t - time);
    const bd = best ? Math.abs(best.time - time) : Infinity;
    if (d < bd || (d === bd && !isSun)) best = { time: t, sun: isSun };
  };
  sun.forEach((t) => consider(t, true));
  dates.forEach((t) => consider(t, false));
  return best;
}

/** `value` at `time`, linearly interpolated between sorted samples; undefined outside them. */
export function interpolate<T extends { time: Date }>(
  points: T[],
  time: number,
  value: (p: T) => number,
): number | undefined {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || time < points[0].time.getTime() || time > points[hi].time.getTime()) {
    return undefined;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time.getTime() <= time) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.time.getTime() - a.time.getTime();
  return span === 0
    ? value(a)
    : value(a) + ((value(b) - value(a)) * (time - a.time.getTime())) / span;
}

export type StopKind =
  "High" | "Low" | "Slack" | "Flood" | "Ebb" | "Max flood" | "Max ebb" | "Sunrise" | "Sunset";

export interface Stop {
  time: number;
  label: StopKind;
}

/** What a screen reader hears for each stop, after the app's VoiceOver labels. */
const SPOKEN: Record<StopKind, string> = {
  High: "High tide",
  Low: "Low tide",
  Slack: "Slack current",
  Flood: "Flood current",
  Ebb: "Ebb current",
  "Max flood": "Maximum flood current",
  "Max ebb": "Maximum ebb current",
  Sunrise: "Sunrise",
  Sunset: "Sunset",
};

/** Water and sun stops inside the drawn data, in time order; a sun event sharing an instant comes first. */
export function scrubberStops(water: Stop[], days: Day[], start: number, end: number): Stop[] {
  const sun = days.flatMap((d): Stop[] => [
    ...(d.sunrise === undefined ? [] : [{ time: d.sunrise, label: "Sunrise" as const }]),
    ...(d.sunset === undefined ? [] : [{ time: d.sunset, label: "Sunset" as const }]),
  ]);
  return [...sun, ...water]
    .filter((s) => s.time >= start && s.time <= end)
    .sort((a, b) => a.time - b.time);
}

/** "28m" or "3h 28m", floored to whole minutes. */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** A countdown in words, for screen readers: "3 hours, 28 minutes". */
export function spokenDuration(ms: number, locale?: string): string {
  const minutes = Math.floor(ms / 60_000);
  const unit = (n: number, unit: string) =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(n);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return unit(m, "minute");
  return m === 0
    ? unit(h, "hour")
    : new Intl.ListFormat(locale, { style: "short", type: "unit" }).format([
        unit(h, "hour"),
        unit(m, "minute"),
      ]);
}

export interface Commentary {
  stop: Stop;
  /** Compact countdown: "28m", "3h 28m". */
  duration: string;
  /** The whole relationship for screen readers: "Maximum flood current in 28 minutes". */
  spoken: string;
}

/** The commentary pill: the first stop more than a second after `time`. */
export function commentary(time: number, stops: Stop[], locale?: string): Commentary | undefined {
  const stop = stops.find((s) => s.time > time + 1000);
  if (!stop) return undefined;
  return {
    stop,
    duration: formatCountdown(stop.time - time),
    spoken: `${SPOKEN[stop.label]} in ${spokenDuration(stop.time - time, locale)}`,
  };
}

/** Sorted, unique times inside [start, end]. */
export function targetsWithin(times: number[], start: number, end: number): number[] {
  return [...new Set(times.filter((t) => t >= start && t <= end))].sort((a, b) => a - b);
}
