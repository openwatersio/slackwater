import { d2r } from "./astronomy/constants.js";
import defaultConstituentModels from "./constituents/index.js";
import { resolveFundamentals } from "./node-corrections/index.js";
import { findExtremes, findSlacks, evalH } from "./harmonics/extremes.js";
import { createParamsFactory } from "./harmonics/params.js";
import { getTimeline } from "./harmonics/index.js";
import type { HarmonicConstituent } from "./harmonics/index.js";
import type { TimeSpan } from "./index.js";

export type CurrentEventKind = "slack" | "maxFlood" | "maxEbb";

/**
 * One sample of signed major-axis velocity in knots: positive is flood,
 * negative is ebb. Named for the major axis so magnitude and direction of the
 * full current vector can be added later without renaming.
 */
export interface CurrentPoint {
  time: Date;
  /** Hours since the first timeline sample. */
  hour: number;
  speed: number;
}

export interface CurrentEvent {
  time: Date;
  /** Signed knots. Slack events carry the residual near-zero root value. */
  speed: number;
  kind: CurrentEventKind;
  /** Flood or ebb direction in degrees true; absent for slack. */
  direction?: number;
}

export interface CurrentPredictionOptions {
  /** Major-axis flood direction, degrees true (NOAA `meanFloodDir`/azimuth). */
  floodDirection: number;
  /** Ebb direction, degrees true. */
  ebbDirection: number;
  /** Mean flow in knots, added as a Z0 term (NOAA major mean speed). */
  meanFlow?: number;
  /** Nodal correction fundamentals. Defaults to 'iho'. */
  nodeCorrections?: "iho" | "schureman";
}

export interface CurrentTimelineInput extends TimeSpan {
  /** Sampling step in seconds. Defaults to 600. */
  timeFidelity?: number;
}

export interface CurrentPredictor {
  floodDirection: number;
  ebbDirection: number;
  /** Signed major-axis velocity in knots at regular intervals. */
  getTimelinePrediction: (input: CurrentTimelineInput) => CurrentPoint[];
  /** Slack, max flood, and max ebb events in time order. */
  getEventsPrediction: (input: TimeSpan) => CurrentEvent[];
}

/** Maxima below this prominence (knots) are relaxation noise, as for tides. */
const PROMINENCE_THRESHOLD = 0.01;

/** Provider windows snap to this grid, matching the default timeline step. */
const PROVIDER_STEP_SECONDS = 600;

const DAY_MS = 86_400_000;

/**
 * The margin each UTC day is searched with on either side. Neighbouring
 * events are at most ~6 h apart (diurnal), so a day's own events always have
 * their neighbours in view when the prominence filter runs.
 */
const DAY_MARGIN_MS = 8 * 3_600_000;

const byTime = (a: CurrentEvent, b: CurrentEvent) => a.time.getTime() - b.time.getTime();

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
  { floodDirection, ebbDirection, meanFlow = 0, nodeCorrections }: CurrentPredictionOptions,
): CurrentPredictor {
  const fundamentals = resolveFundamentals(nodeCorrections);
  const constituents = inputs
    .filter((c) => defaultConstituentModels[c.name] !== undefined)
    .map((c) => ({ ...c, phase: d2r * c.phase }));
  if (meanFlow !== 0) constituents.push({ name: "Z0", amplitude: meanFlow, phase: 0 });

  /** Root-search setup over [from, to], snapped outward to the provider grid. */
  function windowParams(from: Date, to: Date) {
    const startSec =
      Math.floor(from.getTime() / 1000 / PROVIDER_STEP_SECONDS) * PROVIDER_STEP_SECONDS;
    const endSec = Math.ceil(to.getTime() / 1000 / PROVIDER_STEP_SECONDS) * PROVIDER_STEP_SECONDS;
    const start = new Date(startSec * 1000);
    const endHour = (endSec - startSec) / 3600;
    const correctedParams = createParamsFactory({
      constituents,
      constituentModels: defaultConstituentModels,
      fundamentals,
      start,
      endHour,
    });
    return { startMs: start.getTime(), endHour, correctedParams };
  }

  /**
   * All events inside one search window. Maxima are velocity extrema
   * (slope-zeros) classified by the SIGN of velocity, NOAA's convention: a
   * relaxation extremum that never reverses stays flood or ebb per its sign.
   * Double-tide handling is a height concept and is forced off.
   */
  function eventsInWindow(from: Date, to: Date): CurrentEvent[] {
    const { startMs, endHour, correctedParams } = windowParams(from, to);

    const maxima = findExtremes(0, endHour, {
      startMs,
      isDoubleTide: false,
      prominenceThreshold: PROMINENCE_THRESHOLD,
      getParams: correctedParams(),
    }).map(({ time, level }): CurrentEvent =>
      level >= 0
        ? { time, speed: level, kind: "maxFlood", direction: floodDirection }
        : { time, speed: level, kind: "maxEbb", direction: ebbDirection },
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
        constituentModels: defaultConstituentModels,
        fundamentals,
        start: timeline.items[0],
        endHour: timeline.hours[timeline.hours.length - 1],
      })();

      return timeline.items.map((time, i) => {
        const hour = timeline.hours[i];
        return { time, hour, speed: evalH(hour, getParams(hour)) };
      });
    },

    /**
     * Events over whole UTC days covering [start, end], each day searched on
     * its own with an 8 h margin either side and trimmed to the day. The list
     * for any range is therefore a concatenation of per-day lists and never
     * depends on the range asked for; a single-window search does, because
     * the extrema filter skips a window holding two or fewer results.
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
  /** Mean flood direction at the subordinate, degrees true. */
  floodDirection: number;
  /** Mean ebb direction at the subordinate, degrees true. */
  ebbDirection: number;
}

/**
 * NOAA's subordinate current reduction over reference events a caller already
 * holds: max flood and ebb are time-shifted and speed-scaled per phase; a
 * slack takes the offset of the phase it PRECEDES (its next non-slack event)
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
          return {
            time: shift(event.time, offsets.floodTimeOffset),
            speed: event.speed * offsets.floodSpeedRatio,
            kind: "maxFlood",
            direction: offsets.floodDirection,
          };
        case "maxEbb":
          return {
            time: shift(event.time, offsets.ebbTimeOffset),
            speed: event.speed * offsets.ebbSpeedRatio,
            kind: "maxEbb",
            direction: offsets.ebbDirection,
          };
        case "slack": {
          const next = refEvents.slice(i + 1).find((e) => e.kind !== "slack");
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
 * water, not slack. A window still open at the frame edge is kept and ends at
 * the edge.
 */
export function slackWindows(
  timeline: Pick<CurrentPoint, "time" | "speed">[],
  threshold: number,
): SlackWindow[] {
  if (timeline.length === 0) return [];

  // Signed distance out of the band — negative inside, zero at the edge.
  const out = (s: Pick<CurrentPoint, "time" | "speed">) => Math.abs(s.speed) - threshold;
  const cross = (a: (typeof timeline)[number], b: (typeof timeline)[number]) =>
    new Date(
      a.time.getTime() + (out(a) / (out(a) - out(b))) * (b.time.getTime() - a.time.getTime()),
    );

  const windows: SlackWindow[] = [];
  let from: Date | undefined = out(timeline[0]) <= 0 ? timeline[0].time : undefined;
  let turned = false;
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
    if ((inA || inB) && a.speed > 0 !== b.speed > 0) turned = true;
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
