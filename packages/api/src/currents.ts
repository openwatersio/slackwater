import type { Request, Response, RequestHandler } from "express";
import {
  loadStations,
  type Station,
  type StationDatabase,
  type Filter,
} from "@slackwater/database";
import { findCurrentStation, parseCurrentBin, currentStationUnavailableIn } from "slackwater";
import * as validate from "./validate.js";
import { loadCurrentsOpenapi } from "./openapi.js";
import { createApiRouter, type RouterOptions } from "./router.js";
import { stationsInBounds } from "./bbox.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// A year of 10-minute samples is about 4 MB of JSON; longer spans can exhaust memory.
const MAX_SPAN_DAYS = 366;

/** Signed speeds are knots along the flood axis: positive flood, negative ebb. */
const UNITS = "knots";

/** HTTP status for each reason `currentStationUnavailableIn` gives. */
const REFUSAL_STATUS = { redistribution: 451, "no-model": 404 } as const;

/**
 * Thrown for a request the routes refuse. The router's error handler turns it
 * into `{ message }` with this status.
 */
class RefusedError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RefusedError";
    this.status = status;
  }
}

type StationFields = Parameters<typeof currentStationUnavailableIn>[1] & Pick<Station, "id">;
type Predictor = Awaited<ReturnType<typeof findCurrentStation>>;

const isPrimaryBin = (station: Pick<Station, "id">) =>
  parseCurrentBin(station.id).bin === undefined;
const primaryCurrent: Filter = (station) => station.kind === "current" && isPrimaryBin(station);

/** What these routes derive from the database, built on the first request. */
function createCatalog(db: StationDatabase) {
  const currentStations = db.accepted.filter((station) => station.kind === "current");
  const unprefixedIds = new Set(
    currentStations.filter((s) => !s.id.includes("/")).map((s) => s.id),
  );

  /** Every bin of each station, keyed by the primary bin's id, primary first. */
  const binsByStation = new Map<string, { id: string; bin?: number }[]>();
  for (const station of currentStations) {
    const { base, bin } = parseCurrentBin(station.id);
    const bins = binsByStation.get(base) ?? [];
    if (bin === undefined) bins.unshift({ id: station.id });
    else bins.push({ id: station.id, bin });
    binsByStation.set(base, bins);
  }

  return { db, currentStations, unprefixedIds, binsByStation };
}

type Catalog = ReturnType<typeof createCatalog>;
let catalog: Catalog | undefined;

async function loadCatalog() {
  return (catalog ??= createCatalog(await loadStations()));
}

// Every station these routes see comes from the same `accepted` list the map is built from.
function binsOf({ binsByStation }: Catalog, station: Pick<Station, "id">) {
  return binsByStation.get(parseCurrentBin(station.id).base)!;
}

/** Station fields for listings, plus the flags a client needs to pick and gate a station. */
function summarize(catalog: Catalog, station: Station) {
  const { id, name, region, country, continent, latitude, longitude, timezone, type } = station;
  return {
    id,
    name,
    region,
    country,
    continent,
    latitude,
    longitude,
    timezone,
    type,
    ...describe(catalog, station),
  };
}

function describe(catalog: Catalog, station: StationFields) {
  const unavailable = currentStationUnavailableIn(catalog.db, station);
  return {
    bins: binsOf(catalog, station),
    predictions: unavailable === undefined,
    ...(unavailable && { unavailable: unavailable.message }),
  };
}

function assertPredictable({ db }: Catalog, station: StationFields) {
  const unavailable = currentStationUnavailableIn(db, station);
  if (unavailable) throw new RefusedError(REFUSAL_STATUS[unavailable.reason], unavailable.message);
}

async function find({ unprefixedIds, binsByStation }: Catalog, req: Request): Promise<Predictor> {
  const { source, id } = req.params as { source?: string; id: string };
  const query = source === undefined ? id : `${source}/${id}`;
  const { base, bin } = parseCurrentBin(query);
  // A single segment only names stations without a source prefix, never a source-local id.
  if (source === undefined && !unprefixedIds.has(base)) {
    throw new RefusedError(404, `Current station not found: ${query}`);
  }
  try {
    return await findCurrentStation(query);
  } catch (error) {
    const bins = binsByStation.get(base);
    if (bin !== undefined && bins) {
      const available = bins.map((b) => b.id).join(", ");
      throw new RefusedError(404, `${base} has no bin ${bin}. Available: ${available}`);
    }
    throw new RefusedError(404, (error as Error).message);
  }
}

function spanOptions(req: Request) {
  const start = validate.date(req.query, "start", () => new Date());
  const end = validate.date(req.query, "end", () => new Date(start.getTime() + 7 * DAY_MS));
  if (start.getTime() >= end.getTime()) {
    throw new validate.ValidationError([{ path: "end", message: "end must be after start" }]);
  }
  if (end.getTime() - start.getTime() > MAX_SPAN_DAYS * DAY_MS) {
    throw new validate.ValidationError([
      { path: "end", message: `end must be within ${MAX_SPAN_DAYS} days of start` },
    ]);
  }
  return { start, end };
}

type Span = ReturnType<typeof spanOptions>;

function positionOptions(req: Request) {
  return {
    latitude: validate.number(req.query, "latitude", { required: true, min: -90, max: 90 })!,
    longitude: validate.number(req.query, "longitude", { required: true, min: -180, max: 180 })!,
  };
}

/**
 * Stations with no model are data gaps and are skipped. A station whose source
 * forbids redistribution still decides when it is nearest: substituting the
 * next one out would answer for a different channel, sometimes hundreds of
 * kilometers away.
 */
const locatable =
  ({ db }: Catalog): Filter =>
  (station) =>
    primaryCurrent(station) && currentStationUnavailableIn(db, station)?.reason !== "no-model";

async function nearest(catalog: Catalog, req: Request) {
  // No maxDistance, so some current station is always nearest.
  const [station, distance] = catalog.db.nearest({
    ...positionOptions(req),
    filter: locatable(catalog),
  })!;
  assertPredictable(catalog, station);
  return { predictor: await findCurrentStation(station.id), distance };
}

function directions(station: StationFields) {
  // The database gives every current station a `current` block, empty when it has no data.
  const { flood_direction, ebb_direction } = station.current!;
  return {
    ...(flood_direction !== undefined && { floodDirection: flood_direction }),
    ...(ebb_direction !== undefined && { ebbDirection: ebb_direction }),
  };
}

function events(catalog: Catalog, predictor: Predictor, span: Span, distance?: number) {
  const { station, events } = predictor.getEventsPrediction(span);
  return {
    units: UNITS,
    ...directions(station),
    station: { ...station, ...describe(catalog, station) },
    ...(distance !== undefined && { distance }),
    // Harmonic stations return every event in each UTC day the span touches.
    events: events.filter(({ time }) => time >= span.start && time <= span.end),
  };
}

function timeline(catalog: Catalog, predictor: Predictor, span: Span, distance?: number) {
  const { station, timeline } = predictor.getTimelinePrediction(span);
  return {
    units: UNITS,
    ...directions(station),
    station: { ...station, ...describe(catalog, station) },
    ...(distance !== undefined && { distance }),
    timeline,
  };
}

/** The tidal current routes. */
export function createCurrentRoutes(options: RouterOptions = {}) {
  return createApiRouter(loadCurrentsOpenapi, options, (router) => {
    router.get("/events", async (req: Request, res: Response) => {
      const span = spanOptions(req);
      const catalog = await loadCatalog();
      const { predictor, distance } = await nearest(catalog, req);
      res.json(events(catalog, predictor, span, distance));
    });

    router.get("/timeline", async (req: Request, res: Response) => {
      const span = spanOptions(req);
      const catalog = await loadCatalog();
      const { predictor, distance } = await nearest(catalog, req);
      res.json(timeline(catalog, predictor, span, distance));
    });

    router.get("/stations", async (req: Request, res: Response) => {
      const query = validate.string(req.query, "query");
      const latitude = validate.number(req.query, "latitude", { min: -90, max: 90 });
      const longitude = validate.number(req.query, "longitude", { min: -180, max: 180 });
      const maxResults = validate.number(req.query, "maxResults", {
        integer: true,
        min: 1,
        max: 100,
        default: 10,
      });
      const maxDistance = validate.number(req.query, "maxDistance", { min: 0 });
      const bboxParam = validate.bbox(req.query);
      const catalog = await loadCatalog();
      const { db, currentStations } = catalog;
      const summary = (station: Station) => summarize(catalog, station);

      if (query) {
        res.json(db.search(query, { filter: primaryCurrent, maxResults }).map(summary));
        return;
      }

      if (bboxParam) {
        res.json(stationsInBounds(db, bboxParam, primaryCurrent).map(summary));
        return;
      }

      if (latitude === undefined || longitude === undefined) {
        res.json(currentStations.filter(isPrimaryBin).map(summary));
        return;
      }

      res.json(
        db
          .near({ latitude, longitude, maxResults, maxDistance, filter: primaryCurrent })
          .map(([station, distance]) => ({
            ...station,
            distance,
            ...describe(catalog, station),
          })),
      );
    });

    const show: RequestHandler = async (req, res) => {
      const catalog = await loadCatalog();
      const station = await find(catalog, req);
      res.json({ ...station, ...describe(catalog, station) });
    };
    const showEvents: RequestHandler = async (req, res) => {
      const span = spanOptions(req);
      const catalog = await loadCatalog();
      const station = await find(catalog, req);
      assertPredictable(catalog, station);
      res.json(events(catalog, station, span));
    };
    const showTimeline: RequestHandler = async (req, res) => {
      const span = spanOptions(req);
      const catalog = await loadCatalog();
      const station = await find(catalog, req);
      assertPredictable(catalog, station);
      res.json(timeline(catalog, station, span));
    };
    // Ids without a source prefix (the curated CHS and Boundary Pass records) are a single path segment. Anything else
    // falls through to the source/id routes, which share the two-segment shape.
    const unprefixedOnly: RequestHandler = async (req, _res, next) => {
      const { unprefixedIds } = await loadCatalog();
      next(unprefixedIds.has(parseCurrentBin(req.params.id as string).base) ? undefined : "route");
    };

    router.get("/stations/:id", show);
    router.get("/stations/:id/events", unprefixedOnly, showEvents);
    router.get("/stations/:id/timeline", unprefixedOnly, showTimeline);
    router.get("/stations/:source/:id", show);
    router.get("/stations/:source/:id/events", showEvents);
    router.get("/stations/:source/:id/timeline", showTimeline);
  });
}
