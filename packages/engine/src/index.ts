import harmonics from "./harmonics/index.js";
import { predictionCorrections, type NodeCorrections } from "./node-corrections/resolve.js";
import { constituentModels } from "./constituents/index.js";
import type { ConstituentDefinition } from "./constituents/types.js";
import type { HarmonicConstituent } from "./harmonics/index.js";
import type { TimelinePoint, Extreme, ExtremeOffsets } from "./harmonics/prediction.js";

export { default as astro } from "./astronomy/index.js";
export {
  fit,
  type HarmonicSample,
  type HarmonicFit,
  type FitOptions,
  type FittedConstituent,
} from "./fit.js";
export {
  foremanCandidates,
  selectConstituents,
  type Candidate,
  type ConstituentSelection,
  type SelectionOptions,
  type SelectionResult,
} from "./selection.js";
export { foreman } from "./node-corrections/index.js";
export { foremanLines } from "./node-corrections/foreman.js";
export { chsCurrentFit, chsTideFit, projectChsCurrent } from "./chs.js";
export { default as constituents, defineConstituents } from "./constituents/index.js";
export type * from "./astronomy/index.js";
export type * from "./constituents/index.js";
export type * from "./harmonics/index.js";
export type * from "./node-corrections/index.js";
export type { NodeCorrections } from "./node-corrections/resolve.js";

export interface TidePredictionOptions {
  offset?: number | false;
  /**
   * Nodal correction formulas, IHO's by default. Foreman's, as t_tide and UTide
   * apply them, take the site's `latitude` and refuse the catalog's Sa, S1 and OQ2.
   */
  nodeCorrections?: NodeCorrections;
  /** Degrees north, for Foreman's corrections. */
  latitude?: number;
  prominenceThreshold?: number;
  /** Constituents to add to the catalog, or to replace catalog entries of the same name. */
  definitions?: readonly ConstituentDefinition[];
}

export interface TimeSpan {
  start: Date;
  end: Date;
}

export interface ExtremesInput extends TimeSpan {
  labels?: {
    high?: string;
    low?: string;
  };
  offsets?: ExtremeOffsets;
}

export interface TimelineInput extends TimeSpan {
  timeFidelity?: number;
  offsets?: ExtremeOffsets;
}

export interface TidePrediction {
  getTimelinePrediction: (params: TimelineInput) => TimelinePoint[];
  getExtremesPrediction: (params: ExtremesInput) => Extreme[];
  getWaterLevelAtTime: (params: { time: Date; offsets?: ExtremeOffsets }) => TimelinePoint;
}

export function createTidePredictor(
  constituents: HarmonicConstituent[],
  options: TidePredictionOptions = {},
): TidePrediction {
  const { nodeCorrections, latitude, definitions, ...harmonicsOpts } = options;
  const models = constituentModels(definitions);
  const harmonicsOptions = {
    harmonicConstituents: constituents,
    constituentModels: models,
    fundamentals: predictionCorrections(nodeCorrections, latitude, constituents, models),
    offset: false as number | false,
    ...harmonicsOpts,
  };

  const tidePrediction: TidePrediction = {
    getTimelinePrediction: ({
      start,
      end,
      timeFidelity,
      offsets,
    }: TimelineInput): TimelinePoint[] => {
      return harmonics(harmonicsOptions)
        .setTimeSpan(start, end)
        .prediction({ timeFidelity })
        .getTimelinePrediction({ offsets });
    },

    getExtremesPrediction: ({ start, end, labels, offsets }: ExtremesInput): Extreme[] => {
      return harmonics(harmonicsOptions)
        .setTimeSpan(start, end)
        .prediction()
        .getExtremesPrediction({ labels, offsets });
    },

    getWaterLevelAtTime: ({
      time,
      offsets,
    }: {
      time: Date;
      offsets?: ExtremeOffsets;
    }): TimelinePoint => {
      return harmonics(harmonicsOptions).predictionAt(time).getTimelinePrediction({ offsets })[0];
    },
  };

  return tidePrediction;
}

export type { HarmonicConstituent, TimelinePoint, Extreme };
export * from "./currents.js";
export * from "./readings/current.js";
export * from "./readings/series.js";
export * from "./readings/tide.js";
export * from "./station.js";
