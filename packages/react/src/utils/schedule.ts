import { addDays, startOfDay } from "./time.js";

const HOUR = 3_600_000;
/** Four days back, so a strip up to about 3,400 px wide can still center now. */
export const BACK_MS = 96 * HOUR;
/** The week, plus half a phone so its last event can still reach the center line. */
export const AHEAD_MS = 180 * HOUR;

/** The window a station page loads around the week starting at `anchor`. */
export function stationWindow(anchor: number): { start: string; end: string } {
  return {
    start: new Date(anchor - BACK_MS).toISOString(),
    end: new Date(anchor + AHEAD_MS).toISOString(),
  };
}

export type SchedulePill = "high" | "low" | "flood" | "ebb" | "slack";

export interface ScheduleEntry {
  time: number;
  pill: SchedulePill;
  /** "6.2 ft", "3.1 kn"; absent prints "—". */
  value?: string;
  /** A flood or ebb's set, in degrees true. */
  direction?: number;
}

export interface ScheduleDay {
  start: number;
  entries: ScheduleEntry[];
}

/** The week from `anchor`'s station-local midnight, grouped by day; days without events are left out. */
export function scheduleDays(
  entries: ScheduleEntry[],
  anchor: number,
  timeZone: string,
): ScheduleDay[] {
  const end = addDays(anchor, 7, timeZone);
  const days: ScheduleDay[] = [];
  for (const e of [...entries].sort((a, b) => a.time - b.time)) {
    if (e.time < anchor || e.time >= end) continue;
    const start = startOfDay(e.time, timeZone);
    const last = days[days.length - 1];
    if (last?.start === start) last.entries.push(e);
    else days.push({ start, entries: [e] });
  }
  return days;
}

/** The entry time nearest `time`, which the schedule highlights; the earlier on a tie. */
export function nearestEntry(entries: ScheduleEntry[], time: number): number | undefined {
  let best: number | undefined;
  for (const e of entries) {
    if (best === undefined || Math.abs(e.time - time) < Math.abs(best - time)) best = e.time;
  }
  return best;
}
