import prediction from "./prediction.js";
import defaultConstituentModels from "../constituents/index.js";
import type { Constituent } from "../constituents/types.js";
import { iho, Fundamentals } from "../node-corrections/index.js";
import { d2r } from "../astronomy/constants.js";
import type { HarmonicConstituent, Prediction } from "./prediction.js";

export type * from "./prediction.js";

export interface HarmonicsOptions {
  harmonicConstituents: HarmonicConstituent[];
  constituentModels?: Record<string, Constituent>;
  offset: number | false;
  fundamentals?: Fundamentals;
  prominenceThreshold?: number;
}

export interface PredictionOptions {
  timeFidelity?: number;
  prominenceThreshold?: number;
}

export interface Harmonics {
  setTimeSpan: (startTime: Date | number, endTime: Date | number) => Harmonics;
  prediction: (options?: PredictionOptions) => Prediction;
  /** Prediction at exactly `time`; `prediction()` snaps its start to the timeline step. */
  predictionAt: (time: Date) => Prediction;
}

const getDate = (time: Date | number): Date => {
  if (time instanceof Date) {
    return time;
  }
  if (typeof time === "number") {
    return new Date(time * 1000);
  }
  throw new Error("Invalid date format, should be a Date object, or timestamp");
};

/** Snap a time to a multiple of `seconds`, in epoch seconds. */
const snap = (time: Date, seconds: number, round: (x: number) => number) =>
  round(time.getTime() / 1000 / seconds) * seconds;

const getTimeline = (start: Date, end: Date, seconds: number = 10 * 60) => {
  const items: Date[] = [];
  const endTime = snap(end, seconds, Math.ceil);
  const startTime = snap(start, seconds, Math.floor);
  let lastTime = startTime;
  const hours: number[] = [];
  while (lastTime <= endTime) {
    items.push(new Date(lastTime * 1000));
    hours.push((lastTime - startTime) / (60 * 60));
    lastTime += seconds;
  }

  return {
    items,
    hours,
  };
};

const harmonicsFactory = ({
  harmonicConstituents,
  constituentModels = defaultConstituentModels,
  offset,
  fundamentals = iho,
  prominenceThreshold,
}: HarmonicsOptions): Harmonics => {
  if (!Array.isArray(harmonicConstituents)) {
    throw new Error("Harmonic constituents are not an array");
  }
  const constituents: HarmonicConstituent[] = [];
  harmonicConstituents.forEach((constituent) => {
    if (typeof constituent.name === "undefined") {
      throw new Error("Harmonic constituents must have a name property");
    }
    if (constituentModels[constituent.name] !== undefined) {
      constituents.push({
        ...constituent,
        phase: d2r * constituent.phase,
      });
    }
  });

  if (offset !== false) {
    constituents.push({
      name: "Z0",
      phase: 0,
      amplitude: offset,
    });
  }

  let start = new Date();
  let end = new Date();

  const harmonics: Harmonics = {} as Harmonics;

  harmonics.setTimeSpan = (startTime: Date | number, endTime: Date | number): Harmonics => {
    start = getDate(startTime);
    end = getDate(endTime);
    if (start.getTime() >= end.getTime()) {
      throw new Error("Start time must be before end time");
    }
    return harmonics;
  };

  harmonics.prediction = (options?: PredictionOptions): Prediction => {
    const opts = typeof options !== "undefined" ? options : { timeFidelity: 10 * 60 };
    const seconds = opts.timeFidelity ?? 10 * 60;
    const [from, to] = [start, end];
    return prediction({
      // Built only on demand: extremes need just the span, and a 19-year timeline is a million Dates.
      timeline: () => getTimeline(from, to, seconds),
      constituents,
      constituentModels,
      start: new Date(snap(from, seconds, Math.floor) * 1000),
      end: new Date(snap(to, seconds, Math.ceil) * 1000),
      fundamentals,
      prominenceThreshold: opts.prominenceThreshold ?? prominenceThreshold,
    });
  };

  harmonics.predictionAt = (time: Date): Prediction =>
    prediction({
      timeline: () => ({ items: [time], hours: [0] }),
      constituents,
      constituentModels,
      start: time,
      end: time,
      fundamentals,
      prominenceThreshold,
    });

  return Object.freeze(harmonics);
};

export default harmonicsFactory;
export { getDate, getTimeline };
