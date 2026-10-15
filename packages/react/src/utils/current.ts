import type { CurrentEvent, CurrentTimelineEntry } from "../types.js";
import { type Day, spokenTime } from "./time.js";
import { UNIT_MS } from "./scrubber.js";

/** A run of time around slack when the current stays within the boat-speed threshold. */
export interface SlackWindow {
  start: Date;
  end: Date;
}

/** What shows in place of a strip with fewer than two samples. */
export const EMPTY_MESSAGE = "No current predictions for this period.";

/** The app's default boat-speed threshold for slack windows, in knots. */
export const DEFAULT_SLACK_THRESHOLD = 0.5;

/** Absolute speed anchors (knots) for the ramp stops, shared with the app. */
const RAMP_ANCHORS = [0.5, 3, 8, 12];
const RAMP_STOPS: [number, number, number][] = [
  [0xf5, 0xc9, 0x6b],
  [0xf5, 0xc9, 0x6b],
  [0xe8, 0x76, 0x3c],
  [0xc9, 0x3a, 0x32],
];

const hex = (c: number[]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * The speed ramp color for an absolute speed in knots. The ramp is the same
 * at every station, never enters green, and clamps at both ends.
 */
export function speedColor(knots: number): string {
  const s = Math.abs(knots);
  const i = RAMP_ANCHORS.findIndex((a) => s < a);
  if (i === 0) return hex(RAMP_STOPS[0]);
  if (i === -1) return hex(RAMP_STOPS[RAMP_STOPS.length - 1]);
  const f = (s - RAMP_ANCHORS[i - 1]) / (RAMP_ANCHORS[i] - RAMP_ANCHORS[i - 1]);
  return hex(RAMP_STOPS[i - 1].map((c, k) => c + (RAMP_STOPS[i][k] - c) * f));
}

/** The speed thread's opacity: invisible below 0.5 kn, opaque from 3 kn. */
export function threadOpacity(knots: number): number {
  return Math.min(1, Math.max(0, (Math.abs(knots) - 0.5) / 2.5));
}

const POINTS16 = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");

/** A bearing in degrees true as a 16-point compass word. */
export function compass16(degrees: number): string {
  return POINTS16[((Math.round(degrees / 22.5) % 16) + 16) % 16];
}

/**
 * The workable window around one slack: where |speed| stays within
 * `threshold`, interpolated at the band crossings and clamped to the series.
 * When both samples bracketing the slack sit outside the band, the straight
 * reversal between them still crosses it, so the window is where that
 * segment enters and leaves the band. Either way the window holds the slack itself.
 * Undefined for a slack outside the series.
 */
export function slackWindowAround(
  timeline: CurrentTimelineEntry[],
  slack: number,
  threshold: number,
): SlackWindow | undefined {
  const n = timeline.length;
  if (n === 0 || slack < timeline[0].time.getTime() || slack > timeline[n - 1].time.getTime()) {
    return undefined;
  }
  const at = (i: number) => timeline[i].time.getTime();
  const inBand = (i: number) => Math.abs(timeline[i].speed) <= threshold;
  let i = n - 1;
  while (at(i) > slack) i--;
  let k: number;
  if (inBand(i)) k = i;
  else if (i + 1 < n && inBand(i + 1)) k = i + 1;
  else if (i + 1 < n && timeline[i].speed > 0 !== timeline[i + 1].speed > 0) {
    const a = Math.abs(timeline[i].speed);
    const span = a + Math.abs(timeline[i + 1].speed);
    const dt = at(i + 1) - at(i);
    return {
      start: new Date(Math.min(slack, at(i) + (dt * (a - threshold)) / span)),
      end: new Date(Math.max(slack, at(i) + (dt * (a + threshold)) / span)),
    };
  } else return undefined;
  const cross = (a: number, b: number) => {
    const va = Math.abs(timeline[a].speed);
    const vb = Math.abs(timeline[b].speed);
    return at(a) + ((at(b) - at(a)) * (threshold - va)) / (vb - va);
  };
  let lo = k;
  while (lo > 0 && inBand(lo - 1)) lo--;
  let hi = k;
  while (hi < n - 1 && inBand(hi + 1)) hi++;
  return {
    start: new Date(Math.min(slack, lo > 0 ? cross(lo - 1, lo) : at(0))),
    end: new Date(Math.max(slack, hi < n - 1 ? cross(hi, hi + 1) : at(n - 1))),
  };
}

/**
 * The measured window around every slack, each window once however many
 * slacks share it. A slack with no window is a zero-width run, so it draws,
 * times and stops as a dot like any short run.
 */
export function slackRuns(
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  threshold: number,
): SlackWindow[] {
  const first = timeline[0]?.time.getTime();
  const last = timeline[timeline.length - 1]?.time.getTime();
  const windows = events
    .filter((e) => e.kind === "slack" && e.time.getTime() >= first && e.time.getTime() <= last)
    .map(
      (e) =>
        slackWindowAround(timeline, e.time.getTime(), threshold) ?? { start: e.time, end: e.time },
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  // Windows are whole in-band stretches or single crossings, so two either match or are disjoint.
  return windows.filter((w, i) => i === 0 || w.start > windows[i - 1].end);
}

/** A run narrower than a five-unit dot draws as a dot, and is one stop, at its center. */
export function isDotRun(run: SlackWindow): boolean {
  return run.end.getTime() - run.start.getTime() < 5 * UNIT_MS;
}

/** The middle of a run: where a dot run draws and the one moment it names. */
export function runCenter(run: SlackWindow): number {
  return (run.start.getTime() + run.end.getTime()) / 2;
}

/** Signed speed at `time`, linearly interpolated; undefined outside the timeline. */
export function speedAt(timeline: CurrentTimelineEntry[], time: number): number | undefined {
  let lo = 0;
  let hi = timeline.length - 1;
  if (hi < 0 || time < timeline[0].time.getTime() || time > timeline[hi].time.getTime()) {
    return undefined;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].time.getTime() <= time) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo];
  const b = timeline[hi];
  const span = b.time.getTime() - a.time.getTime();
  return span === 0 ? a.speed : a.speed + ((b.speed - a.speed) * (time - a.time.getTime())) / span;
}

export type CurrentState = "Slack" | "Max flood" | "Max ebb" | "Flooding" | "Ebbing";

export interface CurrentReading {
  state: CurrentState;
  speed: number;
  /** Set in degrees true; absent in slack or when the station has none. */
  direction?: number;
}

export interface Directions {
  flood?: number;
  ebb?: number;
}

/** The lead reading at `time`, following the app's scrubber rules. */
export function readCurrent(
  time: number,
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  windows: SlackWindow[],
  directions: Directions,
): CurrentReading | undefined {
  const speed = speedAt(timeline, time);
  if (speed === undefined) return undefined;
  // A dot run reads Slack at its center, where the magnet parks under the dot.
  const inRun = (w: SlackWindow) =>
    (w.start.getTime() <= time && time < w.end.getTime()) ||
    (isDotRun(w) && Math.abs(time - runCenter(w)) <= 1000);
  if (windows.some(inRun)) {
    return { state: "Slack", speed };
  }
  const direction = speed >= 0 ? directions.flood : directions.ebb;
  const max = events.find((e) => e.kind !== "slack" && Math.abs(e.time.getTime() - time) <= 1000);
  const state: CurrentState = max
    ? max.kind === "maxFlood"
      ? "Max flood"
      : "Max ebb"
    : speed >= 0
      ? "Flooding"
      : "Ebbing";
  return direction === undefined ? { state, speed } : { state, speed, direction };
}

export type StopKind = "Slack" | "Flood" | "Ebb" | "Max flood" | "Max ebb" | "Sunrise" | "Sunset";

export interface Stop {
  time: number;
  label: StopKind;
}

/** What a screen reader hears for each stop, after the app's VoiceOver labels. */
const SPOKEN: Record<StopKind, string> = {
  Slack: "Slack current",
  Flood: "Flood current",
  Ebb: "Ebb current",
  "Max flood": "Maximum flood current",
  "Max ebb": "Maximum ebb current",
  Sunrise: "Sunrise",
  Sunset: "Sunset",
};

/**
 * The water stops the commentary walks: each run's opening, its closing named
 * for the water that follows, and each maximum. A dot run is one stop at its
 * center. A run clamped to the series has no measured edge there, so none is
 * invented.
 */
export function currentStops(
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  runs: SlackWindow[],
): Stop[] {
  const first = timeline[0]?.time.getTime();
  const last = timeline[timeline.length - 1]?.time.getTime();
  const stops: Stop[] = [];
  for (const w of runs) {
    if (isDotRun(w)) {
      stops.push({ time: runCenter(w), label: "Slack" });
      continue;
    }
    if (w.start.getTime() > first) stops.push({ time: w.start.getTime(), label: "Slack" });
    if (w.end.getTime() < last) {
      const after = speedAt(timeline, w.end.getTime() + 1000) ?? 0;
      stops.push({ time: w.end.getTime(), label: after >= 0 ? "Flood" : "Ebb" });
    }
  }
  for (const e of events) {
    if (e.kind === "maxFlood") stops.push({ time: e.time.getTime(), label: "Max flood" });
    else if (e.kind === "maxEbb") stops.push({ time: e.time.getTime(), label: "Max ebb" });
  }
  return stops.sort((a, b) => a.time - b.time);
}

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

/**
 * The magnet's targets: every stop plus each slack instant, inside the drawn
 * data, sorted and unique. A slack inside a dot run snaps to the dot instead.
 */
export function snapTargets(
  stops: Stop[],
  events: CurrentEvent[],
  runs: SlackWindow[],
  start: number,
  end: number,
): number[] {
  const dots = runs.filter(isDotRun);
  const slacks = events
    .filter((e) => e.kind === "slack")
    .map((e) => e.time.getTime())
    .filter((t) => !dots.some((w) => w.start.getTime() <= t && t <= w.end.getTime()));
  const times = [...stops.map((s) => s.time), ...slacks].filter((t) => t >= start && t <= end);
  return [...new Set(times)].sort((a, b) => a - b);
}

/** Absolute speed to one decimal in the locale's digits, never "-0.0". */
export function formatSpeed(knots: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(knots));
}

/** One spoken reading: state, speed, set when known, then the dated station clock and zone. */
export function spokenReading(
  reading: CurrentReading,
  time: number,
  timeZone: string,
  locale?: string,
): string {
  const set =
    reading.direction === undefined || reading.state === "Slack"
      ? []
      : [`setting ${compass16(reading.direction)}`];
  return [
    reading.state,
    `${formatSpeed(reading.speed, locale)} knots`,
    ...set,
    spokenTime(time, timeZone, locale),
  ].join(", ");
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
