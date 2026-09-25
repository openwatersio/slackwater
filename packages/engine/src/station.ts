import {
  createTidePredictor,
  type ExtremesInput,
  type TimelineInput,
  type TimeSpan,
  type Extreme,
  type TimelinePoint,
} from "./index.js";
import type { HarmonicConstituent, ExtremeOffsets } from "./harmonics/index.js";
import {
  createCurrentPredictor,
  createSubordinateCurrentPredictor,
  type CurrentEvent,
  type CurrentPoint,
  type CurrentPredictor,
  type CurrentTimelineInput,
} from "./currents.js";

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

  function getPredictor({ datum = defaultDatum, nodeCorrections }: StationPredictionOptions = {}) {
    let offset = 0;

    if (datum) {
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

      offset = mslOffset - datumOffset;
    }

    return createTidePredictor(harmonic_constituents, { offset, nodeCorrections });
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
      const extremes = getPredictor({ datum, nodeCorrections })
        .getExtremesPrediction({ ...options, offsets: station.offsets })
        .map((e) => toPreferredUnits(e, units));

      return { datum, units, station, distance, extremes };
    },

    getTimelinePrediction({
      datum = defaultDatum,
      units = defaultUnits,
      nodeCorrections,
      ...options
    }: StationTimelineOptions) {
      const timeline = getPredictor({ datum, nodeCorrections })
        .getTimelinePrediction({ ...options, offsets: station.offsets })
        .map((e) => toPreferredUnits(e, units));

      return { datum, units, station, distance, timeline };
    },

    getWaterLevelAtTime({
      time,
      datum = defaultDatum,
      units = defaultUnits,
      nodeCorrections,
    }: StationWaterLevelOptions) {
      const prediction = toPreferredUnits(
        getPredictor({ datum, nodeCorrections }).getWaterLevelAtTime({
          time,
          offsets: station.offsets,
        }),
        units,
      );

      return { datum, units, station, distance, ...prediction };
    },
  };
}

/**
 * A current station's `current` block, mirroring @slackwater/database
 * `CurrentData`. Subordinate offset times are in minutes, as NOAA publishes
 * them; speeds are knots throughout.
 */
export type CurrentStationData = {
  /** Major-axis flood direction, degrees true. */
  flood_direction?: number;
  /** Ebb direction, degrees true. */
  ebb_direction?: number;
  /** Knots; the constant term added to the harmonic sum. */
  mean_flow?: number;
  /** Subordinate currents only. Times in minutes, ratios dimensionless. */
  offsets?: {
    reference: string;
    slack_before_flood?: number;
    slack_before_ebb?: number;
    flood_time?: number;
    ebb_time?: number;
    flood_speed_ratio?: number;
    ebb_speed_ratio?: number;
  };
};

export type CurrentStation = Station & {
  kind: "current";
  current?: CurrentStationData;
};

export type CurrentStationPredictionOptions = {
  /** Nodal correction fundamentals. Defaults to 'iho'. */
  nodeCorrections?: "iho" | "schureman";
};

export type CurrentStationEventsOptions = TimeSpan & CurrentStationPredictionOptions;
export type CurrentStationTimelineOptions = CurrentTimelineInput & CurrentStationPredictionOptions;

export type CurrentStationPrediction = {
  station: CurrentStation;
  distance?: number;
};

export type CurrentStationEventsPrediction = CurrentStationPrediction & {
  events: CurrentEvent[];
};

export type CurrentStationTimelinePrediction = CurrentStationPrediction & {
  timeline: CurrentPoint[];
};

export type CurrentStationPredictor = CurrentStation & {
  distance?: number;
  getEventsPrediction: (options: CurrentStationEventsOptions) => CurrentStationEventsPrediction;
  getTimelinePrediction: (
    options: CurrentStationTimelineOptions,
  ) => CurrentStationTimelinePrediction;
};

export type UseCurrentStationOptions = {
  /**
   * The resolved reference station for a subordinate — the station named by
   * `current.offsets.reference`. Station lookup is outside the engine, so the
   * caller resolves the id.
   */
  reference?: CurrentStation;
  distance?: number;
};

/**
 * Wrap a database current station in a predictor. Speeds are signed knots
 * along the flood axis — no datums and no unit conversion. A station with its
 * own harmonic constituents is predicted harmonically even when it also lists
 * offsets; the subordinate reduction applies only when the constituents are
 * empty.
 */
export function useCurrentStation(
  station: CurrentStation,
  { reference, distance }: UseCurrentStationOptions = {},
): CurrentStationPredictor {
  function harmonic(s: CurrentStation, nodeCorrections?: "iho" | "schureman") {
    if (s.harmonic_constituents.length === 0) return undefined;
    return createCurrentPredictor(s.harmonic_constituents, {
      floodDirection: s.current?.flood_direction ?? 0,
      ebbDirection: s.current?.ebb_direction ?? 0,
      meanFlow: s.current?.mean_flow ?? 0,
      nodeCorrections,
    });
  }

  function getPredictor(nodeCorrections?: "iho" | "schureman"): CurrentPredictor {
    const own = harmonic(station, nodeCorrections);
    if (own) return own;

    const offsets = station.current?.offsets;
    if (!offsets) {
      throw new Error(
        `Current station ${station.id} has neither harmonic constituents nor subordinate offsets`,
      );
    }
    if (!reference) {
      throw new Error(
        `Current station ${station.id} is subordinate to ${offsets.reference}; pass that station as options.reference`,
      );
    }
    const ref = harmonic(reference, nodeCorrections);
    if (!ref) {
      throw new Error(`Reference station ${reference.id} has no harmonic constituents`);
    }

    // Database offset times are minutes; the predictor takes seconds.
    return createSubordinateCurrentPredictor(ref, {
      slackBeforeFloodOffset: (offsets.slack_before_flood ?? 0) * 60,
      slackBeforeEbbOffset: (offsets.slack_before_ebb ?? 0) * 60,
      floodTimeOffset: (offsets.flood_time ?? 0) * 60,
      ebbTimeOffset: (offsets.ebb_time ?? 0) * 60,
      floodSpeedRatio: offsets.flood_speed_ratio ?? 1,
      ebbSpeedRatio: offsets.ebb_speed_ratio ?? 1,
      floodDirection: station.current?.flood_direction ?? 0,
      ebbDirection: station.current?.ebb_direction ?? 0,
    });
  }

  return {
    ...station,
    distance,

    getEventsPrediction({ nodeCorrections, ...options }: CurrentStationEventsOptions) {
      const events = getPredictor(nodeCorrections).getEventsPrediction(options);
      return { station, distance, events };
    },

    getTimelinePrediction({ nodeCorrections, ...options }: CurrentStationTimelineOptions) {
      const timeline = getPredictor(nodeCorrections).getTimelinePrediction(options);
      return { station, distance, timeline };
    },
  };
}

function toPreferredUnits<T extends { level: number }>(prediction: T, units: Units): T {
  let { level } = prediction;
  if (units === "feet") level *= feetPerMeter;
  else if (units !== "meters") throw new Error(`Unsupported units: ${units}`);
  return { ...prediction, level };
}
