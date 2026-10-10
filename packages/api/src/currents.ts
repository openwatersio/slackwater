import type { Request, Response, RequestHandler } from "express";
import {
  stations,
  search,
  bbox as bboxQuery,
  type Station,
  type Filter,
} from "@slackwater/database";
import { nearestCurrentStation, currentStationsNear, findCurrentStation } from "slackwater";
import * as validate from "./validate.js";
import { currentsOpenapi } from "./openapi.js";
import { createApiRouter, type RouterOptions } from "./router.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// A year of 10-minute samples is about 4 MB of JSON; longer spans can exhaust memory.
const MAX_SPAN_DAYS = 366;

/** Signed speeds are knots along the flood axis: positive flood, negative ebb. */
const UNITS = "knots";

/**
 * Thrown for a station the API must not predict. The routes' error handler
 * turns it into `{ message }` with this status.
 */
class UnavailableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UnavailableError";
    this.status = status;
  }
}

/** The fields shared by database records and engine predictors that these routes read. */
type StationFields = Pick<Station, "id" | "name" | "harmonic_constituents" | "current"> & {
  source: Pick<Station["source"], "name">;
};

const currentStations = stations.filter((station) => station.kind === "current");
const unprefixedIds = new Set(currentStations.filter((s) => !s.id.includes("/")).map((s) => s.id));

/** `noaa/EPT0003@11` is bin 11 of `noaa/EPT0003`; the bare id is the station's primary bin. */
function parseBin(id: string): { base: string; bin?: number } {
  const match = /^(.*)@(0|[1-9]\d*)$/.exec(id);
  return match ? { base: match[1], bin: Number(match[2]) } : { base: id };
}

const isPrimaryBin = (station: StationFields) => parseBin(station.id).bin === undefined;

/** Every bin of each station, keyed by the primary bin's id, primary first. */
const binsByStation = new Map<string, { id: string; bin?: number }[]>();
for (const station of currentStations) {
  const { base, bin } = parseBin(station.id);
  const bins = binsByStation.get(base) ?? [];
  if (bin === undefined) bins.unshift({ id: station.id });
  else bins.push({ id: station.id, bin });
  binsByStation.set(base, bins);
}

// Every station these routes see comes from the same `stations` list the map is built from.
function binsOf(station: StationFields) {
  return binsByStation.get(parseBin(station.id).base)!;
}

const CHS = "Canadian Hydrographic Service";

/**
 * Why predictions for this station can't be served, with the HTTP status to
 * refuse them with, or undefined when they can. CHS terms forbid re-serving
 * its predictions, so its records carry identity only and clients fetch from
 * CHS directly, as slackwater.xyz and the app do.
 */
function unavailable(station: StationFields): { status: number; reason: string } | undefined {
  if (station.source.name === CHS) {
    return {
      status: 451,
      reason: `Predictions for ${station.name} are published by the ${CHS}, whose terms do not allow them to be redistributed. Get them from https://tides.gc.ca/en/tides-currents-and-water-levels`,
    };
  }
  if (station.harmonic_constituents.length === 0 && !station.current?.offsets) {
    return {
      status: 404,
      reason: `${station.name} has no harmonic constituents or subordinate offsets to predict from`,
    };
  }
  return undefined;
}

const predictable: Filter = (station) => unavailable(station) === undefined;

/** Station fields for listings, plus the flags a client needs to pick and gate a station. */
function summarize(station: Station) {
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
    ...describe(station),
  };
}

function describe(station: StationFields) {
  const refusal = unavailable(station);
  return {
    bins: binsOf(station),
    predictions: refusal === undefined,
    ...(refusal && { unavailable: refusal.reason }),
  };
}

function find(req: Request) {
  const { source, id } = req.params as { source?: string; id: string };
  const query = source === undefined ? id : `${source}/${id}`;
  // A single segment only names stations without a source prefix, never a source-local id.
  if (source === undefined && !unprefixedIds.has(id)) {
    throw new UnavailableError(404, `Current station not found: ${id}`);
  }
  try {
    return findCurrentStation(query);
  } catch (error) {
    const { base, bin } = parseBin(query);
    const bins = binsByStation.get(base);
    if (bin !== undefined && bins) {
      const available = bins.map((b) => b.id).join(", ");
      throw new UnavailableError(404, `${base} has no bin ${bin}. Available: ${available}`);
    }
    throw new UnavailableError(404, (error as Error).message);
  }
}

function assertPredictable(station: StationFields) {
  const refusal = unavailable(station);
  if (refusal) throw new UnavailableError(refusal.status, refusal.reason);
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

function positionOptions(req: Request) {
  return {
    latitude: validate.number(req.query, "latitude", { required: true, min: -90, max: 90 })!,
    longitude: validate.number(req.query, "longitude", { required: true, min: -180, max: 180 })!,
  };
}

type Predictor = ReturnType<typeof findCurrentStation>;

function nearest(req: Request): Predictor {
  return nearestCurrentStation({
    ...positionOptions(req),
    filter: (station) => isPrimaryBin(station) && predictable(station),
  });
}

function directions(station: StationFields) {
  // The database gives every current station a `current` block, empty when it has no data.
  const { flood_direction, ebb_direction } = station.current!;
  return {
    ...(flood_direction !== undefined && { floodDirection: flood_direction }),
    ...(ebb_direction !== undefined && { ebbDirection: ebb_direction }),
  };
}

function events(predictor: Predictor, req: Request) {
  const span = spanOptions(req);
  const { station, distance, events } = predictor.getEventsPrediction(span);
  const { floodDirection, ebbDirection } = directions(station);
  return {
    units: UNITS,
    ...directions(station),
    station: { ...station, ...describe(station) },
    ...(distance !== undefined && { distance }),
    // The engine fills a missing direction with 0, which would read as due north.
    // Harmonic stations return every event in each UTC day the span touches.
    events: events
      .filter(({ time }) => time >= span.start && time <= span.end)
      .map(({ direction, ...event }) => {
        const known = event.kind === "maxFlood" ? floodDirection : ebbDirection;
        return direction !== undefined && known !== undefined ? { ...event, direction } : event;
      }),
  };
}

function timeline(predictor: Predictor, req: Request) {
  const { station, distance, timeline } = predictor.getTimelinePrediction(spanOptions(req));
  return {
    units: UNITS,
    ...directions(station),
    station: { ...station, ...describe(station) },
    ...(distance !== undefined && { distance }),
    timeline,
  };
}

/** The tidal current routes. */
export function createCurrentRoutes(options: RouterOptions = {}) {
  return createApiRouter(currentsOpenapi, options, (router) => {
    router.get("/events", (req: Request, res: Response) => {
      res.json(events(nearest(req), req));
    });

    router.get("/timeline", (req: Request, res: Response) => {
      res.json(timeline(nearest(req), req));
    });

    router.get("/stations", (req: Request, res: Response) => {
      const query = req.query.query as string | undefined;
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
      const filter: Filter = (station) => station.kind === "current" && isPrimaryBin(station);

      if (query) {
        return res.json(search(query, { filter, maxResults }).map(summarize));
      }

      if (bboxParam) {
        return res.json(bboxQuery(bboxParam, { filter }).map(summarize));
      }

      if (latitude === undefined || longitude === undefined) {
        return res.json(currentStations.filter(isPrimaryBin).map(summarize));
      }

      res.json(
        currentStationsNear({ latitude, longitude, maxResults, maxDistance, filter }).map(
          (station) => ({ ...station, ...describe(station) }),
        ),
      );
    });

    const show: RequestHandler = (req, res) => {
      const station = find(req);
      res.json({ ...station, ...describe(station) });
    };
    const showEvents: RequestHandler = (req, res) => {
      const station = find(req);
      assertPredictable(station);
      res.json(events(station, req));
    };
    const showTimeline: RequestHandler = (req, res) => {
      const station = find(req);
      assertPredictable(station);
      res.json(timeline(station, req));
    };
    // Ids without a source prefix (CHS) are a single path segment. Anything else
    // falls through to the source/id routes, which share the two-segment shape.
    const unprefixedOnly: RequestHandler = (req, _res, next) =>
      next(unprefixedIds.has(req.params.id as string) ? undefined : "route");

    router.get("/stations/:id", show);
    router.get("/stations/:id/events", unprefixedOnly, showEvents);
    router.get("/stations/:id/timeline", unprefixedOnly, showTimeline);
    router.get("/stations/:source/:id", show);
    router.get("/stations/:source/:id/events", showEvents);
    router.get("/stations/:source/:id/timeline", showTimeline);
  });
}
