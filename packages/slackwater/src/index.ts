import {
  loadStations,
  type Filter,
  type NearOptions,
  type NearestOptions,
  type Station as DatabaseStation,
  type StationDatabase,
} from "@slackwater/database";
import {
  useStation,
  useCurrentStation,
  type Station,
  type StationPredictor,
  type StationExtremesOptions,
  type StationTimelineOptions,
  type StationWaterLevelOptions,
  type CurrentStation,
  type CurrentStationPredictor,
  type CurrentStationEventsOptions,
  type CurrentStationTimelineOptions,
} from "@slackwater/engine";

export { slackWindows } from "@slackwater/engine";

// The database carries both tide and current stations; each prediction kind
// only works with its own. Derived on first use, so importing reads no data.
let tideStations: DatabaseStation[] | undefined;
let currentStations: DatabaseStation[] | undefined;
const kindFilter =
  (kind: "tide" | "current", filter?: Filter): Filter =>
  (station) =>
    station.kind === kind && (filter?.(station) ?? true);
const tideFilter = (filter?: Filter) => kindFilter("tide", filter);

/**
 * Location lookups only pick a station's primary bin, and only stations that
 * can be predicted. Secondary bins and unpredictable stations are still found
 * by id.
 */
const currentFilter = (db: StationReferences, filter?: Filter) =>
  kindFilter(
    "current",
    (station) =>
      parseCurrentBin(station.id).bin === undefined &&
      currentStationUnavailableIn(db, station) === undefined &&
      (filter?.(station) ?? true),
  );

/**
 * Split a current station id into its station and depth bin. NOAA stations
 * with several depth bins list each one as its own station: `noaa/EPT0003@11`
 * is bin 11 of `noaa/EPT0003`, and the bare id is the station's primary bin.
 */
export function parseCurrentBin(id: string): { base: string; bin?: number } {
  const match = /^(.*)@(0|[1-9]\d*)$/.exec(id);
  return match ? { base: match[1], bin: Number(match[2]) } : { base: id };
}

/** Why a current station can't be predicted. */
export type CurrentStationUnavailable = {
  /**
   * `redistribution`: the source's terms forbid re-serving its predictions.
   * `no-model`: the station has no constituents or subordinate offsets.
   */
  reason: "redistribution" | "no-model";
  message: string;
};

const CHS = "Canadian Hydrographic Service";

/** The station fields `currentStationUnavailable` reads. */
type CurrentStationFields = Pick<DatabaseStation, "name" | "harmonic_constituents" | "current"> & {
  source: Pick<DatabaseStation["source"], "name">;
};

/** The database lookup that resolves a subordinate's reference station. */
type StationReferences = Pick<StationDatabase, "byId">;

/**
 * Why predictions for this current station can't be made, or undefined when
 * they can. CHS terms forbid redistributing its predictions, so its records
 * carry identity only and clients fetch predictions from CHS directly.
 */
export async function currentStationUnavailable(
  station: CurrentStationFields,
): Promise<CurrentStationUnavailable | undefined> {
  return currentStationUnavailableIn(await loadStations(), station);
}

/**
 * `currentStationUnavailable` against an already loaded database, for the
 * synchronous filter callbacks that database lookups take.
 */
export function currentStationUnavailableIn(
  db: StationReferences,
  station: CurrentStationFields,
): CurrentStationUnavailable | undefined {
  if (station.source.name === CHS) {
    return {
      reason: "redistribution",
      message: `Predictions for ${station.name} are published by the ${CHS}, whose terms do not allow them to be redistributed. Get them from https://tides.gc.ca/en/tides-currents-and-water-levels`,
    };
  }
  if (station.harmonic_constituents.length > 0) return undefined;
  const referenceId = station.current?.offsets?.reference;
  if (referenceId === undefined) {
    return {
      reason: "no-model",
      message: `${station.name} has no harmonic constituents or subordinate offsets to predict from`,
    };
  }
  if (!db.byId(referenceId)?.harmonic_constituents.length) {
    return {
      reason: "no-model",
      message: `${station.name} is subordinate to ${referenceId}, which has no harmonic constituents to predict from`,
    };
  }
  return undefined;
}

/**
 * Wrap a database current station in an engine predictor, resolving the
 * reference station a subordinate reduces from. A station that can't be
 * predicted keeps its record, and its prediction methods throw why.
 */
function useCurrent(
  db: StationReferences,
  station: DatabaseStation,
  distance?: number,
): CurrentStationPredictor {
  const current = station as CurrentStation;
  const referenceId = current.current?.offsets?.reference;
  const reference = referenceId ? (db.byId(referenceId) as CurrentStation | undefined) : undefined;
  const predictor = useCurrentStation(current, { reference, distance });

  const unavailable = currentStationUnavailableIn(db, station);
  if (!unavailable) return predictor;
  const refuse = () => {
    throw new Error(unavailable.message);
  };
  return { ...predictor, getEventsPrediction: refuse, getTimelinePrediction: refuse };
}

/**
 * Get extremes prediction using the nearest station to the given position.
 *
 * @example
 * ```ts
 * import { getExtremesPrediction } from 'slackwater'
 *
 * const prediction = await getExtremesPrediction({
 *   latitude: 26.7, // or `lat`
 *   longitude: -80.05, // or `lng` or `lon`
 *   start: new Date('2025-12-17'),
 *   end: new Date('2025-12-18'),
 *   datum: 'MLLW', // optional, defaults to station's datum
 * })
 */
export async function getExtremesPrediction(options: NearestOptions & StationExtremesOptions) {
  return (await nearestStation(options)).getExtremesPrediction(options);
}

/**
 * Get timeline prediction using the nearest station to the given position.
 */
export async function getTimelinePrediction(options: NearestOptions & StationTimelineOptions) {
  return (await nearestStation(options)).getTimelinePrediction(options);
}

/**
 * Get water level at a specific time using the nearest station to the given position.
 */
export async function getWaterLevelAtTime(options: NearestOptions & StationWaterLevelOptions) {
  return (await nearestStation(options)).getWaterLevelAtTime(options);
}

/**
 * Find the nearest station to the given position.
 */
export async function nearestStation(options: NearestOptions) {
  const { nearest } = await loadStations();
  const data = nearest({ ...options, filter: tideFilter(options.filter) });
  if (!data) throw new Error(`No stations found with options: ${JSON.stringify(options)}`);
  return useStation(...data);
}

/**
 * Find stations near the given position.
 * @param limit Maximum number of stations to return (default: 10)
 */
export async function stationsNear(options: NearOptions) {
  const { near } = await loadStations();
  return near({ ...options, filter: tideFilter(options.filter) }).map(([station, distance]) =>
    useStation(station, distance),
  );
}

/**
 * Find a specific station by its ID or source ID.
 */
export async function findStation(query: string): Promise<StationPredictor> {
  const { accepted } = await loadStations();
  tideStations ??= accepted.filter((station) => station.kind === "tide");
  const searches = [(s: Station) => s.id === query, (s: Station) => s.source.id === query];

  let found: Station | undefined = undefined;

  for (const search of searches) {
    found = tideStations.find(search);
    if (found) break;
  }

  if (!found) throw new Error(`Station not found: ${query}`);
  return useStation(found);
}

/**
 * Get current events (slack, max flood, max ebb) using the nearest current
 * station to the given position. Speeds are signed knots along the flood axis.
 *
 * @example
 * ```ts
 * import { getCurrentEventsPrediction } from 'slackwater'
 *
 * const prediction = await getCurrentEventsPrediction({
 *   latitude: 48.4, // or `lat`
 *   longitude: -122.64, // or `lng` or `lon`
 *   start: new Date('2025-12-17'),
 *   end: new Date('2025-12-18'),
 * })
 * ```
 */
export async function getCurrentEventsPrediction(
  options: NearestOptions & CurrentStationEventsOptions,
) {
  return (await nearestCurrentStation(options)).getEventsPrediction(options);
}

/**
 * Get a signed current speed timeline (knots) using the nearest current
 * station to the given position.
 */
export async function getCurrentTimelinePrediction(
  options: NearestOptions & CurrentStationTimelineOptions,
) {
  return (await nearestCurrentStation(options)).getTimelinePrediction(options);
}

/**
 * Find the nearest current station to the given position that can be
 * predicted, skipping secondary depth bins.
 */
export async function nearestCurrentStation(options: NearestOptions) {
  const db = await loadStations();
  const data = db.nearest({ ...options, filter: currentFilter(db, options.filter) });
  if (!data) throw new Error(`No current stations found with options: ${JSON.stringify(options)}`);
  return useCurrent(db, ...data);
}

/**
 * Find current stations near the given position that can be predicted,
 * skipping secondary depth bins.
 * @param limit Maximum number of stations to return (default: 10)
 */
export async function currentStationsNear(options: NearOptions) {
  const db = await loadStations();
  return db
    .near({ ...options, filter: currentFilter(db, options.filter) })
    .map(([station, distance]) => useCurrent(db, station, distance));
}

/**
 * Find a specific current station by its ID or source ID, including secondary
 * depth bins (`noaa/EPT0003@11`). A station that can't be predicted is still
 * found; its prediction methods throw the reason `currentStationUnavailable`
 * gives.
 */
export async function findCurrentStation(query: string): Promise<CurrentStationPredictor> {
  const db = await loadStations();
  currentStations ??= db.accepted.filter((station) => station.kind === "current");
  const found =
    currentStations.find((s) => s.id === query) ??
    currentStations.find((s) => s.source.id === query);

  if (!found) throw new Error(`Current station not found: ${query}`);
  return useCurrent(db, found);
}
