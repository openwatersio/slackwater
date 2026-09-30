import type { Constituent } from "../constituents/types.js";
import { iho, type Fundamentals } from "../node-corrections/index.js";
import { findExtremes, evalH, type Extreme } from "./extremes.js";
import { createParamsFactory } from "./params.js";

export type { ConstituentParam, Extreme } from "./extremes.js";

export interface Timeline {
  items: Date[];
  hours: number[];
}

export interface HarmonicConstituent {
  name: string;
  amplitude: number;
  phase: number;
  speed?: number;
  description?: string;
}

export interface TimelinePoint {
  time: Date;
  hour: number;
  level: number;
}

export interface ExtremeOffsets {
  height?: {
    high?: number;
    low?: number;
    type?: "fixed" | "ratio";
  };
  time?: {
    high?: number;
    low?: number;
  };
}

export interface ExtremeLabels {
  high?: string;
  low?: string;
}

export interface ExtremesOptions {
  labels?: ExtremeLabels;
  offsets?: ExtremeOffsets;
}

export interface TimelinePredictionOptions {
  offsets?: ExtremeOffsets;
}

export interface Prediction {
  getExtremesPrediction: (options?: ExtremesOptions) => Extreme[];
  getTimelinePrediction: (options?: TimelinePredictionOptions) => TimelinePoint[];
}

/** Get the height adjustment value for a high or low extreme, with identity default. */
function getHeightOffset(isHigh: boolean, offsets?: ExtremeOffsets): number {
  const value = isHigh ? offsets?.height?.high : offsets?.height?.low;
  return value ?? (offsets?.height?.type === "fixed" ? 0 : 1);
}

function addExtremesOffsets(extreme: Extreme, offsets?: ExtremeOffsets): Extreme {
  if (typeof offsets === "undefined" || !offsets) {
    return extreme;
  }

  const heightAdj = getHeightOffset(extreme.high, offsets);
  if (offsets.height?.type === "fixed") {
    extreme.level += heightAdj;
  } else {
    extreme.level *= heightAdj;
  }
  if (extreme.high && offsets.time?.high) {
    extreme.time = new Date(extreme.time.getTime() + offsets.time.high * 60 * 1000);
  }
  if (extreme.low && offsets.time?.low) {
    extreme.time = new Date(extreme.time.getTime() + offsets.time.low * 60 * 1000);
  }
  return extreme;
}

function getExtremeLabel(label: "high" | "low", highLowLabels?: ExtremeLabels): string {
  if (typeof highLowLabels !== "undefined" && typeof highLowLabels[label] !== "undefined") {
    return highLowLabels[label]!;
  }
  const labels = {
    high: "High",
    low: "Low",
  };
  return labels[label];
}

interface PredictionFactoryParams {
  timeline: Timeline;
  constituents: HarmonicConstituent[];
  constituentModels: Record<string, Constituent>;
  fundamentals?: Fundamentals;
  start: Date;
  prominenceThreshold?: number;
}

/** Linear interpolation between two keyframe values */
function interpolate(fraction: number, a: number, b: number): number {
  return a + fraction * (b - a);
}

function predictionFactory({
  timeline,
  constituents,
  constituentModels,
  start,
  fundamentals = iho,
  prominenceThreshold = 0.01,
}: PredictionFactoryParams): Prediction {
  const startMs = start.getTime();
  const endHour = (timeline.items[timeline.items.length - 1].getTime() - startMs) / 3600000;

  // Generalised Doodson criterion: (M4 + MS4) / M2 > 0.25 indicates a station
  // where shallow-water overtones produce genuine double high/low waters (aggers).
  // The temporal gap filter is disabled for these stations so real aggers are kept.
  const m2Amp = constituents.find((c) => c.name === "M2")?.amplitude ?? 0;
  const m4Amp = constituents.find((c) => c.name === "M4")?.amplitude ?? 0;
  const ms4Amp = constituents.find((c) => c.name === "MS4")?.amplitude ?? 0;
  const isDoubleTide = m2Amp > 0 && (m4Amp + ms4Amp) / m2Amp > 0.25;

  const correctedParams = createParamsFactory({
    constituents,
    constituentModels,
    fundamentals,
    start,
    endHour,
  });

  /** Options shared by both extremes call sites */
  const extremesOptions = { startMs, isDoubleTide, prominenceThreshold };

  function getExtremesPrediction({ labels, offsets }: ExtremesOptions = {}) {
    return findExtremes(0, endHour, { ...extremesOptions, getParams: correctedParams() }).map(
      (extreme) => {
        if (labels) {
          extreme.label = getExtremeLabel(extreme.high ? "high" : "low", labels);
        }
        return addExtremesOffsets(extreme, offsets);
      },
    );
  }

  /** 36-hour buffer in hours — ensures diurnal stations are fully bracketed by extremes. */
  const BUFFER_HOURS = 36;

  function getTimelinePrediction({ offsets }: TimelinePredictionOptions = {}): TimelinePoint[] {
    if (!offsets) {
      const getParams = correctedParams();
      const results: TimelinePoint[] = [];

      for (let i = 0; i < timeline.items.length; i++) {
        const hour = timeline.hours[i];
        results.push({
          time: timeline.items[i],
          hour,
          level: evalH(hour, getParams(hour)),
        });
      }

      return results;
    }

    // Subordinate station interpolation: find reference extremes in a wider
    // range for proper bracketing, build keyframes, then use proportional
    // domain-mapping to rescale the reference curve.
    const refExtremes = findExtremes(-BUFFER_HOURS, endHour + BUFFER_HOURS, {
      ...extremesOptions,
      getParams: correctedParams(),
    });

    // This should never happen since the input timeline should be fully bracketed by extremes,
    // but we need at least two extremes to interpolate between.
    // v8 ignore if -- @preserve
    if (refExtremes.length < 2)
      throw new Error("At least two extremes are required for interpolation with offsets");

    // Build keyframes mapping subordinate time → reference time + corrected levels
    const isFixed = offsets.height?.type === "fixed";
    const keyframes = refExtremes.map((extreme) => {
      const timeOffset = (extreme.high ? offsets.time?.high : offsets.time?.low) ?? 0;
      const heightAdj = getHeightOffset(extreme.high, offsets);

      return {
        subTime: extreme.time.getTime() + timeOffset * 60 * 1000,
        refTime: extreme.time.getTime(),
        refLevel: extreme.level,
        subLevel: isFixed ? extreme.level + heightAdj : extreme.level * heightAdj,
      };
    });

    const getParams = correctedParams();

    // Iterate over the pre-built output timeline
    const results: TimelinePoint[] = [];
    let kfIdx = 0;

    for (let i = 0; i < timeline.items.length; i++) {
      const tMs = timeline.items[i].getTime();

      // Advance to the correct bracketing keyframe pair
      while (kfIdx < keyframes.length - 2 && keyframes[kfIdx + 1].subTime < tMs) {
        kfIdx++;
      }

      const kf0 = keyframes[kfIdx];
      const kf1 = keyframes[kfIdx + 1];

      const interval = kf1.subTime - kf0.subTime;
      const fraction = interval > 0 ? Math.max(0, Math.min(1, (tMs - kf0.subTime) / interval)) : 0;

      // Map subordinate time → reference time (linear), then evaluate reference curve
      const mappedRefTimeMs = interpolate(fraction, kf0.refTime, kf1.refTime);
      const mappedHour = (mappedRefTimeMs - startMs) / 3600000;
      const refLevel = evalH(mappedHour, getParams(mappedHour));

      // Proportional domain mapping: ease the time-linear fraction through the
      // reference curve's shape, then interpolate between subordinate levels.
      // Fallback: when the reference bracket has zero vertical span (two extremes
      // at the same level), fall back to linear interpolation in subordinate time.
      const refRange = kf1.refLevel - kf0.refLevel;
      const normalizedRef = refRange !== 0 ? (refLevel - kf0.refLevel) / refRange : fraction;
      const level = interpolate(normalizedRef, kf0.subLevel, kf1.subLevel);

      results.push({
        time: timeline.items[i],
        hour: timeline.hours[i],
        level,
      });
    }

    return results;
  }

  return Object.freeze({ getExtremesPrediction, getTimelinePrediction });
}

export default predictionFactory;
