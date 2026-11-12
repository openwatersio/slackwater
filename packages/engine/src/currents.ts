import { d2r } from "./astronomy/constants.js";
import { constituentModels } from "./constituents/index.js";
import type { Constituent, ConstituentDefinition } from "./constituents/types.js";
import { resolveFundamentals } from "./node-corrections/index.js";
import { findExtremes, findSlacks, evalH } from "./harmonics/extremes.js";
import { createParamsFactory } from "./harmonics/params.js";
import { getTimeline } from "./harmonics/index.js";
import { bandCrossing } from "./readings/series.js";
import type { HarmonicConstituent } from "./harmonics/index.js";
import type { TimeSpan } from "./index.js";

export type CurrentEventKind = "slack" | "maxFlood" | "maxEbb" | "minFlood" | "minEbb";

/**
 * One sample of signed major-axis velocity in knots: positive is flood,
 * negative is ebb. Magnitude and direction describe the full current vector.
 */
export interface CurrentPoint {
  time: Date;
  /** Hours since the first timeline sample. */
  hour: number;
  speed: number;
  /** Knots; supplied by predictors, optional for caller-synthesized series. */
  magnitude?: number;
  /** Degrees true in [0, 360); absent at zero magnitude or when unknown. */
  direction?: number;
}

export interface CurrentEvent {
  time: Date;
  /** Signed knots. Slack events carry the residual near-zero root value. */
  speed: number;
  kind: CurrentEventKind;
  /**
   * Flood or ebb direction in degrees true. Absent for slack, and absent
   * when the station publishes no direction for that phase.
   */
  direction?: number;
}

export interface CurrentPredictionOptions {
  /** Major-axis flood direction, degrees true (NOAA `meanFloodDir`/azimuth). Omit when unknown. */
  floodDirection?: number;
  /** Ebb direction, degrees true. Omit when unknown. */
  ebbDirection?: number;
  /** Mean flow in knots, added as a Z0 term (NOAA major mean speed). */
  meanFlow?: number;
  /** Minor-axis amplitudes in knots and Greenwich phases in degrees. */
  minorConstituents?: HarmonicConstituent[];
  /** Minor-axis mean flow in knots, positive 90 degrees clockwise from azimuth. */
  minorMeanFlow?: number;
  /** Major-axis azimuth in degrees true. Defaults to floodDirection. */
  azimuth?: number;
  /** Nodal correction fundamentals. Defaults to 'iho'. */
  nodeCorrections?: "iho" | "schureman";
  /** Constituents to add to the catalog, or to replace catalog entries of the same name. */
  definitions?: readonly ConstituentDefinition[];
}

export interface CurrentTimelineInput extends TimeSpan {
  /** Sampling step in seconds. Defaults to 600. */
  timeFidelity?: number;
}

export interface CurrentPredictor {
  floodDirection?: number;
  ebbDirection?: number;
  /** Signed major-axis velocity in knots at regular intervals. */
  getTimelinePrediction: (input: CurrentTimelineInput) => CurrentPoint[];
  /** Slack and flood/ebb maxima and minima in time order. */
  getEventsPrediction: (input: TimeSpan) => CurrentEvent[];
}

/** Maxima below this prominence (knots) are relaxation noise, as for tides. */
const PROMINENCE_THRESHOLD = 0.01;

/** Provider windows snap to this grid, matching the default timeline step. */
const PROVIDER_STEP_SECONDS = 600;

const DAY_MS = 86_400_000;

/**
 * The margin each UTC day is searched with on either side. Slacks are found
 * from the search window's own start, and a root on the window's edge is not
 * guaranteed, so the margin keeps a day's own slacks well inside its search.
 * Maxima find their own context (`findExtremes`).
 */
const DAY_MARGIN_MS = 8 * 3_600_000;

const byTime = (a: CurrentEvent, b: CurrentEvent) => a.time.getTime() - b.time.getTime();

/** A `direction` field to spread into an event, or nothing when it's unknown. */
const withDirection = (direction: number | undefined) =>
  direction === undefined ? {} : { direction };

const wrapDirection = (value: number) => ((value % 360) + 360) % 360;

function axialVector(speed: number, floodDirection?: number, ebbDirection?: number) {
  const direction = speed > 0 ? floodDirection : speed < 0 ? ebbDirection : undefined;
  return {
    magnitude: Math.abs(speed),
    ...withDirection(direction === undefined ? undefined : wrapDirection(direction)),
  };
}

function prepareConstituents(
  inputs: HarmonicConstituent[],
  mean: number,
  models: Record<string, Constituent>,
) {
  const constituents = inputs
    .filter((c) => models[c.name] !== undefined)
    .map((c) => ({ ...c, phase: d2r * c.phase }));
  if (mean !== 0) constituents.push({ name: "Z0", amplitude: mean, phase: 0 });
  return constituents;
}

function checkTimeSpan({ start, end }: TimeSpan): void {
  if (start.getTime() >= end.getTime()) {
    throw new Error("Start time must be before end time");
  }
}

/**
 * Create a predictor for a harmonic current station: the same sum-of-cosines
 * as a tide station, read as signed velocity along the flood axis in knots.
 * Constituent amplitudes are NOAA major-axis amplitudes in knots and phases
 * are `majorPhaseGMT` in degrees.
 */
export function createCurrentPredictor(
  inputs: HarmonicConstituent[],
  {
    floodDirection,
    ebbDirection,
    meanFlow = 0,
    nodeCorrections,
    minorConstituents,
    minorMeanFlow = 0,
    azimuth = floodDirection,
    definitions,
  }: CurrentPredictionOptions,
): CurrentPredictor {
  const fundamentals = resolveFundamentals(nodeCorrections);
  const models = constituentModels(definitions);
  const constituents = prepareConstituents(inputs, meanFlow, models);
  const minor = prepareConstituents(minorConstituents ?? [], minorMeanFlow, models);
  const hasMinor = minor.some((c) => c.amplitude !== 0);

  /** Root-search setup over [from, to], snapped outward to the provider grid. */
  function windowParams(from: Date, to: Date) {
    const startSec =
      Math.floor(from.getTime() / 1000 / PROVIDER_STEP_SECONDS) * PROVIDER_STEP_SECONDS;
    const endSec = Math.ceil(to.getTime() / 1000 / PROVIDER_STEP_SECONDS) * PROVIDER_STEP_SECONDS;
    const start = new Date(startSec * 1000);
    const endHour = (endSec - startSec) / 3600;
    const correctedParams = createParamsFactory({
      constituents,
      constituentModels: models,
      fundamentals,
      start,
      endHour,
    });
    return { startMs: start.getTime(), endHour, correctedParams };
  }

  /**
   * All events inside one search window. Velocity extrema are classified by slope and sign: same-sign lulls
   * are minimum flood/ebb, while slacks remain velocity zero crossings.
   */
  function eventsInWindow(from: Date, to: Date): CurrentEvent[] {
    const { startMs, endHour, correctedParams } = windowParams(from, to);

    const maxima = findExtremes(0, endHour, {
      startMs,
      prominenceThreshold: PROMINENCE_THRESHOLD,
      paramsFrom: (dayStart) =>
        createParamsFactory({
          constituents,
          constituentModels: models,
          fundamentals,
          start: dayStart,
          endHour: 24,
        })(),
    }).map(({ time, level, high }): CurrentEvent =>
      level >= 0
        ? {
            time,
            speed: level,
            kind: high ? "maxFlood" : "minFlood",
            ...withDirection(floodDirection),
          }
        : { time, speed: level, kind: high ? "minEbb" : "maxEbb", ...withDirection(ebbDirection) },
    );

    const slacks = findSlacks(0, endHour, { startMs, getParams: correctedParams() }).map(
      ({ time, speed }): CurrentEvent => ({ time, speed, kind: "slack" }),
    );

    return [...slacks, ...maxima].sort(byTime);
  }

  return {
    floodDirection,
    ebbDirection,

    getTimelinePrediction({ start, end, timeFidelity }: CurrentTimelineInput): CurrentPoint[] {
      checkTimeSpan({ start, end });
      const timeline = getTimeline(start, end, timeFidelity);
      const getParams = createParamsFactory({
        constituents,
        constituentModels: models,
        fundamentals,
        start: timeline.items[0],
        endHour: timeline.hours[timeline.hours.length - 1],
      })();
      const getMinorParams = hasMinor
        ? createParamsFactory({
            constituents: minor,
            constituentModels: models,
            fundamentals,
            start: timeline.items[0],
            endHour: timeline.hours[timeline.hours.length - 1],
          })()
        : undefined;

      return timeline.items.map((time, i) => {
        const hour = timeline.hours[i];
        const speed = evalH(hour, getParams(hour));
        if (!getMinorParams)
          return { time, hour, speed, ...axialVector(speed, floodDirection, ebbDirection) };
        const v = evalH(hour, getMinorParams(hour));
        const magnitude = Math.hypot(speed, v);
        // NOAA's positive minor axis is clockwise from the major axis (https://tidesandcurrents.noaa.gov/publications/techrpt21.pdf, p. 37).
        const direction =
          magnitude === 0 || azimuth === undefined
            ? undefined
            : wrapDirection(azimuth + Math.atan2(v, speed) / d2r);
        return { time, hour, speed, magnitude, ...withDirection(direction) };
      });
    },

    /**
     * Events over whole UTC days covering [start, end], each day searched on
     * its own with an 8 h margin either side and trimmed to the day. The list
     * for any range is therefore a concatenation of per-day lists and never
     * depends on the range asked for; a single-window search does, because
     * slacks are found from the window's own start.
     */
    getEventsPrediction({ start, end }: TimeSpan): CurrentEvent[] {
      checkTimeSpan({ start, end });
      const first = Math.floor(start.getTime() / DAY_MS);
      const last = Math.floor(end.getTime() / DAY_MS);

      const results: CurrentEvent[] = [];
      for (let day = first; day <= last; day++) {
        const dayStart = day * DAY_MS;
        const dayEnd = dayStart + DAY_MS;
        for (const event of eventsInWindow(
          new Date(dayStart - DAY_MARGIN_MS),
          new Date(dayEnd + DAY_MARGIN_MS),
        )) {
          const t = event.time.getTime();
          if (t >= dayStart && t < dayEnd) results.push(event);
        }
      }
      return results;
    },
  };
}

export interface SubordinateCurrentOptions {
  /** Time adjustment in seconds for slack before flood (NOAA publishes minutes; multiply by 60). */
  slackBeforeFloodOffset: number;
  /** Time adjustment in seconds for slack before ebb. */
  slackBeforeEbbOffset: number;
  /** Time adjustment in seconds for max flood. */
  floodTimeOffset: number;
  /** Time adjustment in seconds for max ebb. */
  ebbTimeOffset: number;
  /** Speed scale at max flood. */
  floodSpeedRatio: number;
  /** Speed scale at max ebb. */
  ebbSpeedRatio: number;
  /** Mean flood direction at the subordinate, degrees true. Omit when unknown. */
  floodDirection?: number;
  /** Mean ebb direction at the subordinate, degrees true. Omit when unknown. */
  ebbDirection?: number;
}

/**
 * NOAA's subordinate current reduction over reference events a caller already
 * holds: maxima and minima are time-shifted and speed-scaled per signed phase; a
 * slack takes the offset of the phase it PRECEDES (its next true maximum)
 * and its speed becomes exactly zero. Sorted, since unequal offsets can
 * reorder neighbours.
 */
export function reduceCurrentEvents(
  refEvents: CurrentEvent[],
  offsets: SubordinateCurrentOptions,
): CurrentEvent[] {
  const shift = (time: Date, seconds: number) => new Date(time.getTime() + seconds * 1000);

  return refEvents
    .map((event, i): CurrentEvent => {
      switch (event.kind) {
        case "maxFlood":
        case "minFlood":
          return {
            time: shift(event.time, offsets.floodTimeOffset),
            speed: event.speed * offsets.floodSpeedRatio,
            kind: event.kind,
            ...withDirection(offsets.floodDirection),
          };
        case "maxEbb":
        case "minEbb":
          return {
            time: shift(event.time, offsets.ebbTimeOffset),
            speed: event.speed * offsets.ebbSpeedRatio,
            kind: event.kind,
            ...withDirection(offsets.ebbDirection),
          };
        case "slack": {
          const next = refEvents
            .slice(i + 1)
            .find((e) => e.kind === "maxFlood" || e.kind === "maxEbb");
          const offset =
            next?.kind === "maxEbb" ? offsets.slackBeforeEbbOffset : offsets.slackBeforeFloodOffset;
          return { time: shift(event.time, offset), speed: 0, kind: "slack" };
        }
      }
    })
    .sort(byTime);
}

/**
 * Half-cosine between each pair of neighbouring knots:
 * v(t) = mid + half·cos(π·u), u = (t − t₁)/(t₂ − t₁). It is how NOAA draws a
 * subordinate's curve too. Outside the bracketed span (only if a caller's pad
 * is ever too short) the nearest knot's value holds flat.
 */
function halfCosineCurve(knots: { time: Date; value: number }[], items: Date[]): number[] {
  if (knots.length < 2) return items.map(() => knots[0]?.value ?? 0);
  let i = 0;
  return items.map((item) => {
    const t = item.getTime();
    while (i + 2 < knots.length && knots[i + 1].time.getTime() <= t) i++;
    const t1 = knots[i].time.getTime();
    const t2 = knots[i + 1].time.getTime();
    const v1 = knots[i].value;
    const v2 = knots[i + 1].value;
    const u = Math.min(1, Math.max(0, (t - t1) / (t2 - t1)));
    return (v1 + v2) / 2 + ((v1 - v2) / 2) * Math.cos(Math.PI * u);
  });
}

/**
 * Signed speed at one instant along events that bracket it — the same
 * half-cosine the subordinate timeline draws, for a caller already holding
 * the events (a map full of pins hanging off one reference searches that
 * reference once and reduces per pin).
 */
export function currentSpeedAt(events: CurrentEvent[], time: Date): number {
  return halfCosineCurve(
    events.map((e) => ({ time: e.time, value: e.speed })),
    [time],
  )[0];
}

/**
 * A subordinate current station: no constituents of its own. Its events are
 * the reference predictor's events reduced through NOAA's Current-Tables
 * offsets, and its timeline is a half-cosine drawn through those event knots
 * — a drawing of the table, not a prediction of the water between its rows.
 */
export function createSubordinateCurrentPredictor(
  reference: CurrentPredictor,
  offsets: SubordinateCurrentOptions,
): CurrentPredictor {
  // Enough pad that every event whose reduced time lands inside the requested
  // window has its reference pre-image inside the searched window.
  const eventPadMs =
    (Math.max(
      Math.abs(offsets.slackBeforeFloodOffset),
      Math.abs(offsets.slackBeforeEbbOffset),
      Math.abs(offsets.floodTimeOffset),
      Math.abs(offsets.ebbTimeOffset),
    ) +
      3600) *
    1000;

  function getEventsPrediction({ start, end }: TimeSpan): CurrentEvent[] {
    checkTimeSpan({ start, end });
    const refEvents = reference.getEventsPrediction({
      start: new Date(start.getTime() - eventPadMs),
      end: new Date(end.getTime() + eventPadMs),
    });
    return reduceCurrentEvents(refEvents, offsets).filter((e) => e.time >= start && e.time <= end);
  }

  return {
    floodDirection: offsets.floodDirection,
    ebbDirection: offsets.ebbDirection,
    getEventsPrediction,

    getTimelinePrediction({ start, end, timeFidelity }: CurrentTimelineInput): CurrentPoint[] {
      checkTimeSpan({ start, end });
      // Neighbouring events are ~3 h apart at a semidiurnal station and ~6 h
      // at a diurnal one; 8 h always brackets the window.
      const padMs = 8 * 3_600_000;
      const events = getEventsPrediction({
        start: new Date(start.getTime() - padMs),
        end: new Date(end.getTime() + padMs),
      });
      const timeline = getTimeline(start, end, timeFidelity);
      const values = halfCosineCurve(
        events.map((e) => ({ time: e.time, value: e.speed })),
        timeline.items,
      );
      return timeline.items.map((time, i) => ({
        time,
        hour: timeline.hours[i],
        speed: values[i],
        ...axialVector(values[i], offsets.floodDirection, offsets.ebbDirection),
      }));
    },
  };
}

export interface SlackWindow {
  start: Date;
  end: Date;
}

/**
 * The runs of time when |speed| stays below `threshold` knots around a
 * reversal — the transitable water around slack, as opposed to the instant the
 * current reverses.
 *
 * Endpoints are the interpolated ±threshold band crossings, not the nearest
 * sample. A run only counts if the velocity changes sign inside it: a lull
 * that dips under the threshold and then builds back the way it came is weak
 * water, not slack — including one that touches exactly zero. A window still
 * open at the frame edge is kept and ends at the edge.
 */
export function slackWindows(
  timeline: Pick<CurrentPoint, "time" | "speed">[],
  threshold: number,
): SlackWindow[] {
  if (timeline.length === 0) return [];

  // Signed distance out of the band — negative inside, zero at the edge.
  const out = (s: Pick<CurrentPoint, "time" | "speed">) => Math.abs(s.speed) - threshold;
  // The folded crossing on a reversal step is kept on purpose; see the `slackWindows` paragraph in the README.
  const cross = (a: (typeof timeline)[number], b: (typeof timeline)[number]) =>
    a.speed * b.speed >= 0
      ? bandCrossing(a, b, threshold)
      : new Date(
          a.time.getTime() + (out(a) / (out(a) - out(b))) * (b.time.getTime() - a.time.getTime()),
        );

  const windows: SlackWindow[] = [];
  let from: Date | undefined = out(timeline[0]) <= 0 ? timeline[0].time : undefined;
  let turned = false;
  // Sign of the most recent non-zero sample: a turn means seeing the opposite
  // non-zero sign, so a sample touching exactly zero is not itself a reversal
  // but does not hide one landing on it either.
  let sign = Math.sign(timeline[0].speed);
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    const inA = out(a) <= 0;
    const inB = out(b) <= 0;
    if (!inA && inB) {
      from = cross(a, b);
      turned = false;
    }
    // Checked on the entry and exit steps too, not just the ones wholly
    // inside: at a violent gate the reversal and the band edge land in one
    // sample.
    const bSign = Math.sign(b.speed);
    if ((inA || inB) && sign !== 0 && bSign !== 0 && bSign !== sign) turned = true;
    if (bSign !== 0) sign = bSign;
    if (inA && !inB) {
      if (from && turned) windows.push({ start: from, end: cross(a, b) });
      from = undefined;
      turned = false;
    }
  }
  // A window open at the frame edge is real water; it just has no visible end.
  if (from && turned) windows.push({ start: from, end: timeline[timeline.length - 1].time });
  return windows;
}
