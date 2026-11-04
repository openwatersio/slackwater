import {
  SPOKEN_COMPASS_POINTS,
  compass16,
  compassIndex,
  type CurrentReading,
  type SlackWindow,
} from "@slackwater/engine";
import type { CurrentEvent, CurrentTimelineEntry, SetFormat } from "../types.js";
import { spokenTime } from "./time.js";
import { KNOT_ANCHORS, rampColor } from "./color.js";
import { UNIT_MS, targetsWithin, type Stop } from "./scrubber.js";

export type { CurrentReading, CurrentState, Directions, SlackWindow } from "@slackwater/engine";

/** What shows in place of a strip with fewer than two samples. */
export const EMPTY_MESSAGE = "No current predictions for this period.";

/**
 * The speed ramp color for an absolute speed in knots. The ramp is the same
 * at every station, never enters green, and clamps at both ends.
 */
export function speedColor(knots: number): string {
  return rampColor(knots, KNOT_ANCHORS);
}

/** The speed thread's opacity: invisible below 0.5 kn, opaque from 3 kn. */
export function threadOpacity(knots: number): number {
  return Math.min(1, Math.max(0, (Math.abs(knots) - 0.5) / 2.5));
}

/** Continuous windows show each zero; ordinary windows show their opening, with bare zeros retained. */
export function slackAxisTimes(drawnWindows: SlackWindow[], slacks: number[]): number[] {
  const times = drawnWindows.flatMap((window) => {
    const zeros = slacks.filter((t) => t >= window.start.getTime() && t <= window.end.getTime());
    return zeros.length > 1 ? zeros : [window.start.getTime()];
  });
  times.push(
    ...slacks.filter(
      (t) => !drawnWindows.some((w) => t >= w.start.getTime() && t <= w.end.getTime()),
    ),
  );
  return [...new Set(times)].sort((a, b) => a - b);
}

/** Windows narrower than a turn dot are omitted; their exact zeros remain. */
export function isDotRun(run: SlackWindow): boolean {
  return run.end.getTime() - run.start.getTime() < 5 * UNIT_MS;
}

/** The middle of a run: where a dot run draws and the one moment it names. */
export function runCenter(run: SlackWindow): number {
  return (run.start.getTime() + run.end.getTime()) / 2;
}

/** Forward water stops: drawn window edges, exact zeros, and maxima. */
export function currentStops(
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  runs: SlackWindow[],
): Stop[] {
  const first = timeline[0]?.time.getTime();
  const last = timeline[timeline.length - 1]?.time.getTime();
  const stops: Stop[] = [];
  for (const w of runs) {
    if (isDotRun(w)) continue;
    if (w.start.getTime() > first) stops.push({ time: w.start.getTime(), label: "Slack window" });
    if (w.end.getTime() < last) {
      stops.push({ time: w.end.getTime(), label: "Slack window closes" });
    }
  }
  for (const e of events) {
    if (e.kind === "slack") {
      const time = e.time.getTime();
      const edge = stops.findIndex(
        (s) => (s.label === "Slack window" || s.label === "Slack window closes") && s.time === time,
      );
      if (edge !== -1) stops.splice(edge, 1);
      stops.push({ time, label: "Slack" });
    }
    if (e.kind === "maxFlood") stops.push({ time: e.time.getTime(), label: "Max flood" });
    else if (e.kind === "maxEbb") stops.push({ time: e.time.getTime(), label: "Max ebb" });
  }
  return stops.sort((a, b) => a.time - b.time);
}

/** Exact water stops and zeros inside the drawn data, sorted and unique. */
export function snapTargets(
  stops: Stop[],
  events: CurrentEvent[],
  _runs: SlackWindow[],
  start: number,
  end: number,
): number[] {
  const slacks = events.filter((e) => e.kind === "slack").map((e) => e.time.getTime());
  return targetsWithin([...stops.map((s) => s.time), ...slacks], start, end);
}

/** Absolute speed to one decimal in the locale's digits, never "-0.0". */
export function formatSpeed(knots: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(knots));
}

/** Bearings are measured from true north; the display follows the reader's preference. */
export function formatSet(direction: number, format: SetFormat = "compass"): string {
  return format === "degrees"
    ? `${(((Math.round(direction) % 360) + 360) % 360).toString().padStart(3, "0")}°`
    : compass16(direction);
}

export function spokenBearing(direction: number, format: SetFormat = "compass"): string {
  return format === "degrees"
    ? `${((Math.round(direction) % 360) + 360) % 360} degrees`
    : SPOKEN_COMPASS_POINTS[compassIndex(direction)];
}

export function spokenSet(direction: number, format: SetFormat = "compass"): string {
  return `set ${spokenBearing(direction, format)}`;
}

/** One spoken reading: full speed, set when known, then the dated station clock and zone. */
export function spokenReading(
  reading: CurrentReading,
  time: number,
  timeZone: string,
  locale?: string,
  setFormat: SetFormat = "compass",
): string {
  return [
    `${formatSpeed(reading.magnitude, locale)} knots`,
    ...(reading.direction === undefined ? [] : [spokenSet(reading.direction, setFormat)]),
    spokenTime(time, timeZone, locale),
  ].join(", ");
}
