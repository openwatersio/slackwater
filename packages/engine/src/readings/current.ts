import type { CurrentEvent, CurrentEventKind, CurrentPoint, SlackWindow } from "../currents.js";
import { bandCrossing, interpolate } from "./series.js";

/** The fields of a timeline sample that a reading needs. */
export type CurrentSample = Pick<CurrentPoint, "time" | "speed" | "magnitude" | "direction">;

/** Flood and ebb set in degrees true, as a station publishes them. */
export interface Directions {
  flood?: number;
  ebb?: number;
}

/** The phase of the tide a current reading falls in. */
export type CurrentState = "Slack" | "Max flood" | "Max ebb" | "Flooding" | "Ebbing";

/** The full current vector at an instant. */
export interface CurrentVector {
  magnitude: number;
  /** Predicted set in degrees true; absent at zero speed or when unknown. */
  direction?: number;
}

/** The lead reading at an instant: phase, signed major-axis speed, and the full vector. */
export interface CurrentReading extends CurrentVector {
  state: CurrentState;
  speed: number;
}

/** The 16 compass points as abbreviations, clockwise from north. */
export const COMPASS_POINTS: readonly string[] =
  "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");

/** The 16 compass points as spoken words, in the order of {@link COMPASS_POINTS}. */
export const SPOKEN_COMPASS_POINTS: readonly string[] = [
  "north",
  "north-northeast",
  "northeast",
  "east-northeast",
  "east",
  "east-southeast",
  "southeast",
  "south-southeast",
  "south",
  "south-southwest",
  "southwest",
  "west-southwest",
  "west",
  "west-northwest",
  "northwest",
  "north-northwest",
];

/** The index into the compass point lists nearest a bearing in degrees. */
export function compassIndex(degrees: number): number {
  return ((Math.round(degrees / 22.5) % 16) + 16) % 16;
}

/** A bearing in degrees true as a 16-point compass abbreviation. */
export function compass16(degrees: number): string {
  return COMPASS_POINTS[compassIndex(degrees)];
}

/** Signed speed at `time`, linearly interpolated; undefined outside the timeline. */
export function speedAt(timeline: CurrentSample[], time: Date): number | undefined {
  return interpolate(timeline, time, (p) => p.speed);
}

/** The current vector at `time`, interpolated through bearings; undefined outside the timeline. */
export function vectorAt(
  timeline: CurrentSample[],
  time: Date,
  directions: Directions,
): CurrentVector | undefined {
  const speed = speedAt(timeline, time);
  if (speed === undefined) return undefined;
  const at = time.getTime();
  let lo = 0;
  let hi = timeline.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].time.getTime() <= at) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo];
  const b = timeline[hi];
  const span = b.time.getTime() - a.time.getTime();
  const mix = span === 0 ? 0 : (at - a.time.getTime()) / span;
  if (mix === 0 || mix === 1) {
    const p = mix === 0 ? a : b;
    const magnitude = p.magnitude ?? Math.abs(speed);
    const direction =
      p.magnitude === undefined ? (speed >= 0 ? directions.flood : directions.ebb) : p.direction;
    return { magnitude, ...(magnitude > 1e-9 && direction !== undefined && { direction }) };
  }
  // Scalar phase bearings need not be reciprocal; their reversal must not synthesize crossflow.
  const axialReversal =
    a.magnitude === Math.abs(a.speed) && b.magnitude === Math.abs(b.speed) && a.speed * b.speed < 0;
  if (a.magnitude === undefined || b.magnitude === undefined || axialReversal) {
    const magnitude = Math.abs(speed);
    const direction = axialReversal
      ? (speed >= 0 === a.speed >= 0 ? a : b).direction
      : speed >= 0
        ? directions.flood
        : directions.ebb;
    return { magnitude, ...(magnitude > 1e-9 && direction !== undefined && { direction }) };
  }
  if (
    (a.magnitude !== 0 && a.direction === undefined) ||
    (b.magnitude !== 0 && b.direction === undefined)
  ) {
    return { magnitude: a.magnitude + (b.magnitude - a.magnitude) * mix };
  }
  // Interpolate vectors so north crossings and opposing flows retain their physical meaning.
  const radians = Math.PI / 180;
  const x =
    a.magnitude * Math.sin((a.direction ?? 0) * radians) * (1 - mix) +
    b.magnitude * Math.sin((b.direction ?? 0) * radians) * mix;
  const y =
    a.magnitude * Math.cos((a.direction ?? 0) * radians) * (1 - mix) +
    b.magnitude * Math.cos((b.direction ?? 0) * radians) * mix;
  const magnitude = Math.hypot(x, y);
  const direction = (((Math.atan2(x, y) / radians) % 360) + 360) % 360;
  return { magnitude, ...(magnitude > 1e-9 && { direction }) };
}

/** The lead reading at `time`: Slack or Max within a second of an event, otherwise the flooding or ebbing phase. */
export function readCurrent(
  time: Date,
  timeline: CurrentSample[],
  events: CurrentEvent[],
  directions: Directions,
): CurrentReading | undefined {
  const speed = speedAt(timeline, time);
  const vector = vectorAt(timeline, time, directions);
  if (speed === undefined || vector === undefined) return undefined;
  const near = (e: CurrentEvent) => Math.abs(e.time.getTime() - time.getTime()) <= 1000;
  if (events.some((e) => e.kind === "slack" && near(e))) {
    return { state: "Slack", speed, ...vector };
  }
  const max = events.find((e) => e.kind !== "slack" && near(e));
  const state: CurrentState = max
    ? max.kind === "maxFlood"
      ? "Max flood"
      : "Max ebb"
    : speed >= 0
      ? "Flooding"
      : "Ebbing";
  return { state, speed, ...vector };
}

/** One direction's maxima as unsigned speeds, so floods rank against floods and ebbs against ebbs. */
export function maxSpeeds(
  events: CurrentEvent[],
  kind: Extract<CurrentEventKind, "maxFlood" | "maxEbb">,
): number[] {
  return events.filter((e) => e.kind === kind).map((e) => Math.abs(e.speed));
}

/** The default major-axis speed threshold for slack windows, in knots. */
export const DEFAULT_SLACK_THRESHOLD = 0.5;

/** The workable window around one slack: where |speed| stays within `threshold`, clamped to the series and holding the slack itself; undefined for a slack outside the series or with no reversal to bound. */
export function slackWindowAround(
  timeline: Pick<CurrentPoint, "time" | "speed">[],
  slack: Date,
  threshold: number,
): SlackWindow | undefined {
  const n = timeline.length;
  const at = slack.getTime();
  if (
    threshold <= 0 ||
    n === 0 ||
    at < timeline[0].time.getTime() ||
    at > timeline[n - 1].time.getTime()
  ) {
    return undefined;
  }
  const ms = (i: number) => timeline[i].time.getTime();
  const inBand = (i: number) => Math.abs(timeline[i].speed) <= threshold;
  let i = n - 1;
  while (ms(i) > at) i--;
  let k: number;
  if (inBand(i)) k = i;
  else if (i + 1 < n && inBand(i + 1)) k = i + 1;
  else if (i + 1 < n && timeline[i].speed > 0 !== timeline[i + 1].speed > 0) {
    // A reversal between two out-of-band samples crosses the band along the straight segment of absolute speed.
    const a = Math.abs(timeline[i].speed);
    const span = a + Math.abs(timeline[i + 1].speed);
    const dt = ms(i + 1) - ms(i);
    return {
      start: new Date(Math.min(at, ms(i) + (dt * (a - threshold)) / span)),
      end: new Date(Math.max(at, ms(i) + (dt * (a + threshold)) / span)),
    };
  } else return undefined;
  let lo = k;
  while (lo > 0 && inBand(lo - 1)) lo--;
  let hi = k;
  while (hi < n - 1 && inBand(hi + 1)) hi++;
  const start = lo > 0 ? bandCrossing(timeline[lo - 1], timeline[lo], threshold) : timeline[0].time;
  const end =
    hi < n - 1 ? bandCrossing(timeline[hi], timeline[hi + 1], threshold) : timeline[n - 1].time;
  return {
    start: new Date(Math.min(at, start.getTime())),
    end: new Date(Math.max(at, end.getTime())),
  };
}

/** Touching or overlapping windows around the slacks in the series merged into runs; a slack with no window stays an exact instant. */
export function slackRuns(
  timeline: Pick<CurrentPoint, "time" | "speed">[],
  events: CurrentEvent[],
  threshold: number,
): SlackWindow[] {
  const first = timeline[0]?.time.getTime();
  const last = timeline[timeline.length - 1]?.time.getTime();
  const windows = events
    .filter((e) => e.kind === "slack" && e.time.getTime() >= first && e.time.getTime() <= last)
    .map((e) => slackWindowAround(timeline, e.time, threshold) ?? { start: e.time, end: e.time })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const runs: SlackWindow[] = [];
  for (const window of windows) {
    const previous = runs.at(-1);
    if (previous && window.start <= previous.end) {
      previous.end = new Date(Math.max(previous.end.getTime(), window.end.getTime()));
    } else runs.push(window);
  }
  return runs;
}
