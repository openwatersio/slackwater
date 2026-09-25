import {
  stations,
  stationsById,
  near,
  nearest,
  type Filter,
  type NearOptions,
  type NearestOptions,
  type Station as DatabaseStation,
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
// only works with its own.
const tideStations = stations.filter((station) => station.kind === "tide");
const currentStations = stations.filter((station) => station.kind === "current");
const kindFilter =
  (kind: "tide" | "current", filter?: Filter): Filter =>
  (station) =>
    station.kind === kind && (filter?.(station) ?? true);
const tideFilter = (filter?: Filter) => kindFilter("tide", filter);
const currentFilter = (filter?: Filter) => kindFilter("current", filter);

/**
 * Wrap a database current station in an engine predictor, resolving the
 * reference station a subordinate reduces from.
 */
function useCurrent(station: DatabaseStation, distance?: number): CurrentStationPredictor {
  const current = station as CurrentStation;
  const referenceId = current.current?.offsets?.reference;
  const reference = referenceId
    ? (stationsById.get(referenceId) as CurrentStation | undefined)
    : undefined;
  return useCurrentStation(current, { reference, distance });
}

/**
 * Get extremes prediction using the nearest station to the given position.
 *
 * @example
 * ```ts
 * import { getExtremesPrediction } from 'slackwater'
 *
 * const prediction = getExtremesPrediction({
 *   latitude: 26.7, // or `lat`
 *   longitude: -80.05, // or `lng` or `lon`
 *   start: new Date('2025-12-17'),
 *   end: new Date('2025-12-18'),
 *   datum: 'MLLW', // optional, defaults to station's datum
 * })
 */
export function getExtremesPrediction(options: NearestOptions & StationExtremesOptions) {
  return nearestStation(options).getExtremesPrediction(options);
}

/**
 * Get timeline prediction using the nearest station to the given position.
 */
export function getTimelinePrediction(options: NearestOptions & StationTimelineOptions) {
  return nearestStation(options).getTimelinePrediction(options);
}

/**
 * Get water level at a specific time using the nearest station to the given position.
 */
export function getWaterLevelAtTime(options: NearestOptions & StationWaterLevelOptions) {
  return nearestStation(options).getWaterLevelAtTime(options);
}

/**
 * Find the nearest station to the given position.
 */
export function nearestStation(options: NearestOptions) {
  const data = nearest({ ...options, filter: tideFilter(options.filter) });
  if (!data) throw new Error(`No stations found with options: ${JSON.stringify(options)}`);
  return useStation(...data);
}

/**
 * Find stations near the given position.
 * @param limit Maximum number of stations to return (default: 10)
 */
export function stationsNear(options: NearOptions) {
  return near({ ...options, filter: tideFilter(options.filter) }).map(([station, distance]) =>
    useStation(station, distance),
  );
}

/**
 * Find a specific station by its ID or source ID.
 */
export function findStation(query: string): StationPredictor {
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
 * const prediction = getCurrentEventsPrediction({
 *   latitude: 48.4, // or `lat`
 *   longitude: -122.64, // or `lng` or `lon`
 *   start: new Date('2025-12-17'),
 *   end: new Date('2025-12-18'),
 * })
 * ```
 */
export function getCurrentEventsPrediction(options: NearestOptions & CurrentStationEventsOptions) {
  return nearestCurrentStation(options).getEventsPrediction(options);
}

/**
 * Get a signed current speed timeline (knots) using the nearest current
 * station to the given position.
 */
export function getCurrentTimelinePrediction(
  options: NearestOptions & CurrentStationTimelineOptions,
) {
  return nearestCurrentStation(options).getTimelinePrediction(options);
}

/**
 * Find the nearest current station to the given position.
 */
export function nearestCurrentStation(options: NearestOptions) {
  const data = nearest({ ...options, filter: currentFilter(options.filter) });
  if (!data) throw new Error(`No current stations found with options: ${JSON.stringify(options)}`);
  return useCurrent(...data);
}

/**
 * Find current stations near the given position.
 * @param limit Maximum number of stations to return (default: 10)
 */
export function currentStationsNear(options: NearOptions) {
  return near({ ...options, filter: currentFilter(options.filter) }).map(([station, distance]) =>
    useCurrent(station, distance),
  );
}

/**
 * Find a specific current station by its ID or source ID.
 */
export function findCurrentStation(query: string): CurrentStationPredictor {
  const found =
    currentStations.find((s) => s.id === query) ??
    currentStations.find((s) => s.source.id === query);

  if (!found) throw new Error(`Current station not found: ${query}`);
  return useCurrent(found);
}
