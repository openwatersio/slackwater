import {
  loadStations,
  type Filter,
  type Station as DatabaseStation,
  type StationDatabase,
} from "@slackwater/database";
import {
  findCurrentStation,
  parseCurrentBin,
  currentStationUnavailableIn,
  slackWindows,
} from "slackwater";
import { resolveCoordinates } from "./station.js";

/** Signed speeds are knots along the flood axis: positive flood, negative ebb. */
const UNITS = "knots";

type CurrentStationPredictor = Awaited<ReturnType<typeof findCurrentStation>>;
type StationFields = Parameters<typeof currentStationUnavailableIn>[1] &
  Pick<DatabaseStation, "id">;

export interface Span {
  start: Date;
  end: Date;
}

export const isPrimaryBin = (station: Pick<DatabaseStation, "id">) =>
  parseCurrentBin(station.id).bin === undefined;

/** Current stations at their primary bin: what a listing shows. */
export const primaryCurrent: Filter = (station) =>
  station.kind === "current" && isPrimaryBin(station);

/** What these commands derive from the database. */
function createCatalog(db: StationDatabase) {
  const currentStations = db.accepted.filter((station) => station.kind === "current");

  /** Every bin of each station, keyed by the primary bin's id, primary first. */
  const binsByStation = new Map<string, { id: string; bin?: number }[]>();
  for (const station of currentStations) {
    const { base, bin } = parseCurrentBin(station.id);
    const bins = binsByStation.get(base) ?? [];
    if (bin === undefined) bins.unshift({ id: station.id });
    else bins.push({ id: station.id, bin });
    binsByStation.set(base, bins);
  }

  return { db, currentStations, binsByStation };
}

type Catalog = ReturnType<typeof createCatalog>;
let catalog: Catalog | undefined;

export async function loadCatalog() {
  return (catalog ??= createCatalog(await loadStations()));
}

// Every station this sees comes from the same `accepted` list the map is built from.
function binsOf({ binsByStation }: Catalog, station: Pick<DatabaseStation, "id">) {
  return binsByStation.get(parseCurrentBin(station.id).base)!;
}

/** The flags a reader needs to pick a station and know whether it can be predicted. */
export function describeCurrentStation(catalog: Catalog, station: StationFields) {
  const unavailable = currentStationUnavailableIn(catalog.db, station);
  return {
    bins: binsOf(catalog, station),
    predictions: unavailable === undefined,
    ...(unavailable && { unavailable: unavailable.message }),
  };
}

export interface CurrentStationOptions {
  station?: string;
  near?: string;
  ip?: boolean;
}

export interface ResolvedCurrentStation {
  catalog: Catalog;
  predictor: CurrentStationPredictor;
  distance?: number;
}

/**
 * Find a current station by id. A bare id is the station's primary bin and
 * `@N` selects bin N. An unknown bin lists the bins that exist, and a tide
 * station's id points at the tide commands.
 */
async function findById(catalog: Catalog, query: string): Promise<CurrentStationPredictor> {
  const { db, currentStations } = catalog;
  try {
    return await findCurrentStation(query);
  } catch (error) {
    const { base, bin } = parseCurrentBin(query);
    const station =
      currentStations.find((s) => s.id === base) ??
      currentStations.find((s) => s.source.id === base);
    if (bin !== undefined && station) {
      const available = binsOf(catalog, station)
        .map((b) => b.id)
        .join(", ");
      throw new Error(`${station.id} has no bin ${bin}. Available bins: ${available}`);
    }
    if (db.accepted.some((s) => s.kind === "tide" && (s.id === query || s.source.id === query))) {
      throw new Error(
        `${query} is a tide station. Use "slackwater extremes" or "slackwater timeline" for it.`,
      );
    }
    throw error;
  }
}

/**
 * Stations with no model are data gaps and are skipped. A station whose source
 * forbids redistribution still decides when it is nearest: substituting the
 * next one out would answer for a different channel, sometimes hundreds of
 * kilometers away.
 */
const locatable =
  (db: StationDatabase): Filter =>
  (station) =>
    primaryCurrent(station) && currentStationUnavailableIn(db, station)?.reason !== "no-model";

export async function resolveCurrentStation(
  opts: CurrentStationOptions,
): Promise<ResolvedCurrentStation> {
  const catalog = await loadCatalog();
  if (opts.station) {
    return { catalog, predictor: await findById(catalog, opts.station) };
  }

  if (!opts.near && !opts.ip) {
    throw new Error("No station specified. Use --station, --near, or --ip.");
  }

  const coords = await resolveCoordinates(opts);
  // No maxDistance, so some current station is always nearest.
  const { db } = catalog;
  const [station, distance] = db.nearest({ ...coords, filter: locatable(db) })!;
  const unavailable = currentStationUnavailableIn(db, station);
  if (unavailable) throw new Error(unavailable.message);
  return { catalog, predictor: await findCurrentStation(station.id), distance };
}

function directions(station: StationFields) {
  // The database gives every current station a `current` block, empty when it has no data.
  const { flood_direction, ebb_direction } = station.current!;
  return {
    ...(flood_direction !== undefined && { floodDirection: flood_direction }),
    ...(ebb_direction !== undefined && { ebbDirection: ebb_direction }),
  };
}

/** The fields every current prediction starts with, in the API's shape. */
function header<S extends StationFields>(catalog: Catalog, station: S, distance?: number) {
  return {
    units: UNITS,
    ...directions(station),
    station: { ...station, ...describeCurrentStation(catalog, station) },
    ...(distance !== undefined && { distance }),
  };
}

export function currentEvents(
  { catalog, predictor, distance }: ResolvedCurrentStation,
  span: Span,
) {
  const { station, events } = predictor.getEventsPrediction(span);
  return {
    ...header(catalog, station, distance),
    // Harmonic stations return every event in each UTC day the span touches.
    events: events.filter(({ time }) => time >= span.start && time <= span.end),
  };
}

export function currentTimeline(
  { catalog, predictor, distance }: ResolvedCurrentStation,
  span: Span & { timeFidelity: number },
) {
  const { station, timeline } = predictor.getTimelinePrediction(span);
  return { ...header(catalog, station, distance), timeline };
}

/** Window endpoints are interpolated between samples, so one-minute samples are plenty. */
const SLACK_SAMPLE_SECONDS = 60;

/**
 * `slackWindows` only keeps a window once it sees the current reverse, so
 * sampling starts half a day early to find a slack already under way at the
 * start of the span, and runs as long past the end. A window still open at
 * the padded edge is clamped and marked clipped like any other.
 */
const SLACK_PAD_MS = 12 * 60 * 60 * 1000;

export function currentSlackWindows(
  { catalog, predictor, distance }: ResolvedCurrentStation,
  span: Span & { threshold: number },
) {
  const from = span.start.getTime();
  const to = span.end.getTime();
  const { station, timeline } = predictor.getTimelinePrediction({
    start: new Date(from - SLACK_PAD_MS),
    end: new Date(to + SLACK_PAD_MS),
    timeFidelity: SLACK_SAMPLE_SECONDS,
  });
  return {
    ...header(catalog, station, distance),
    threshold: span.threshold,
    // A window running past either edge of the span is cut off there, so its
    // duration is a lower bound.
    windows: slackWindows(timeline, span.threshold)
      .filter(({ start, end }) => end.getTime() > from && start.getTime() < to)
      .map(({ start, end }) => ({
        start: new Date(Math.max(start.getTime(), from)),
        end: new Date(Math.min(end.getTime(), to)),
        ...((start.getTime() < from || end.getTime() > to) && { clipped: true }),
      })),
  };
}

export type CurrentEventsResult = ReturnType<typeof currentEvents>;
export type CurrentTimelineResult = ReturnType<typeof currentTimeline>;
export type CurrentSlackWindowsResult = ReturnType<typeof currentSlackWindows>;
export type CurrentStationResult = DatabaseStation &
  ReturnType<typeof describeCurrentStation> & { distance?: number };
