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
