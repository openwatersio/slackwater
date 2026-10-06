import {
  createTidePredictor,
  type ExtremesInput,
  type TimelineInput,
  type Extreme,
  type TimelinePoint,
} from "./index.js";
import type { HarmonicConstituent, ExtremeOffsets } from "./harmonics/index.js";

export type Units = "meters" | "feet";

export type Station = {
  id: string;
  name: string;
  continent: string;
  country: string;
  region?: string;
  timezone: string;
  disclaimers?: string;
  latitude: number;
  longitude: number;

  // Data source information
  source: {
    name: string;
    id: string;
    url: string;
  };

  datums: Record<string, number>;
  chart_datum?: string;
  type: "reference" | "subordinate";
  harmonic_constituents: HarmonicConstituent[];
  offsets?: { reference?: string } & ExtremeOffsets;
};

export type StationPredictionOptions = {
  /** Datum to return predictions in. Defaults to the station chart datum when available. */
  datum?: string;

  /** Units for returned water levels. Defaults to 'meters'. */
  units?: Units;

  /** Nodal correction fundamentals. Defaults to 'iho'. */
  nodeCorrections?: "iho" | "schureman";
};

export type StationExtremesOptions = ExtremesInput & StationPredictionOptions;
export type StationTimelineOptions = TimelineInput & StationPredictionOptions;
export type StationWaterLevelOptions = { time: Date } & StationPredictionOptions;

export type StationPrediction = {
  datum: string | undefined;
  units: Units;
  station: Station;
  distance?: number;
};

export type StationExtremesPrediction = StationPrediction & {
  extremes: Extreme[];
};

export type StationTimelinePrediction = StationPrediction & {
  timeline: TimelinePoint[];
};

export type StationWaterLevelPrediction = StationPrediction & TimelinePoint;

export type StationPredictor = Station & {
  distance?: number;
  defaultDatum?: string;
  getExtremesPrediction: (options: StationExtremesOptions) => StationExtremesPrediction;
  getTimelinePrediction: (options: StationTimelineOptions) => StationTimelinePrediction;
  getWaterLevelAtTime: (options: StationWaterLevelOptions) => StationWaterLevelPrediction;
};

const feetPerMeter = 3.2808399;
const defaultUnits: Units = "meters";

export function useStation(station: Station, distance?: number): StationPredictor {
  const { datums, harmonic_constituents } = station;

  // Use station chart datum as the default datum if available
  const defaultDatum =
    station.chart_datum && station.chart_datum in datums ? station.chart_datum : undefined;

  const hasRatioOffsets = station.offsets?.height && station.offsets.height.type !== "fixed";

  /** The offset that moves the MSL-relative harmonic sum into `datum`. */
  function mslAbove(datum: string): number {
    const datumOffset = datums?.[datum];
    const mslOffset = datums?.["MSL"];

    if (typeof datumOffset !== "number") {
      throw new Error(
        `Station ${station.id} missing ${datum} datum. Available datums: ${Object.keys(datums).join(", ")}`,
      );
    }

    if (typeof mslOffset !== "number") {
      throw new Error(
        `Station ${station.id} missing MSL datum, so predictions can't be given in ${datum}.`,
      );
    }

    return mslOffset - datumOffset;
  }

  function getPredictor({ datum = defaultDatum, nodeCorrections }: StationPredictionOptions = {}) {
    const offset = datum ? mslAbove(datum) : 0;

    // NOAA ratio offsets multiply the height above chart datum, so shift to `datum` after them.
    let base = offset;
    if (hasRatioOffsets) {
      if (!defaultDatum) {
        throw new Error(
          `Station ${station.id} missing chart datum, which its ratio height offsets apply to.`,
        );
      }
      base = mslAbove(defaultDatum);
    }

    return {
      predictor: createTidePredictor(harmonic_constituents, { offset: base, nodeCorrections }),
      shift: offset - base,
    };
  }

  return {
    ...station,
    distance,
    defaultDatum,
    getExtremesPrediction({
      datum = defaultDatum,
      units = defaultUnits,
      nodeCorrections,
      ...options
    }: StationExtremesOptions) {
      const { predictor, shift } = getPredictor({ datum, nodeCorrections });
      const extremes = predictor
        .getExtremesPrediction({ ...options, offsets: station.offsets })
        .map((e) => toPreferredUnits(e, units, shift));

      return { datum, units, station, distance, extremes };
    },

    getTimelinePrediction({
      datum = defaultDatum,
      units = defaultUnits,
      nodeCorrections,
      ...options
    }: StationTimelineOptions) {
      const { predictor, shift } = getPredictor({ datum, nodeCorrections });
      const timeline = predictor
        .getTimelinePrediction({ ...options, offsets: station.offsets })
        .map((e) => toPreferredUnits(e, units, shift));

      return { datum, units, station, distance, timeline };
    },

    getWaterLevelAtTime({
      time,
      datum = defaultDatum,
      units = defaultUnits,
      nodeCorrections,
    }: StationWaterLevelOptions) {
      const { predictor, shift } = getPredictor({ datum, nodeCorrections });
      const prediction = toPreferredUnits(
        predictor.getWaterLevelAtTime({ time, offsets: station.offsets }),
        units,
        shift,
      );

      return { datum, units, station, distance, ...prediction };
    },
  };
}

function toPreferredUnits<T extends { level: number }>(
  prediction: T,
  units: Units,
  shift: number,
): T {
  let level = prediction.level + shift;
  if (units === "feet") level *= feetPerMeter;
  else if (units !== "meters") throw new Error(`Unsupported units: ${units}`);
  return { ...prediction, level };
}
