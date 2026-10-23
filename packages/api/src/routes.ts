import type { Request, Response } from "express";
import { stations, Station, search, bbox as bboxQuery } from "@slackwater/database";
import {
  getExtremesPrediction,
  getTimelinePrediction,
  findStation,
  stationsNear,
  currentStationUnavailable,
} from "slackwater";
import openapi from "./openapi.js";
import * as validate from "./validate.js";
import { createApiRouter, type RouterOptions } from "./router.js";

// The database also carries current stations, which createCurrentRoutes serves.
const tideOnly = (station: Station) => station.kind === "tide";
// CHS tide stations carry identity only, since CHS terms forbid re-serving its
// predictions; picking one by location would serve a flat zero tide.
type ModelFields = { harmonic_constituents: unknown[]; offsets?: unknown };
const hasTideModel = (station: ModelFields) =>
  station.harmonic_constituents.length > 0 || station.offsets !== undefined;

/** Whether these routes can predict the station, and why not when they can't. */
function availability(station: Parameters<typeof currentStationUnavailable>[0] & ModelFields) {
  if (hasTideModel(station)) return { predictions: true };
  // With no model, the current rule gives the same reasons: CHS terms, or nothing to predict from.
  return { predictions: false, unavailable: currentStationUnavailable(station)!.message };
}

// The curated CHS records have no source prefix, so a single path segment names them.
const unprefixedIds = new Set(
  stations.filter((s) => tideOnly(s) && !s.id.includes("/")).map((s) => s.id),
);

function show(id: string, res: Response) {
  try {
    const station = findStation(id);
    return res.json({ ...station, ...availability(station) });
  } catch (error) {
    return res.status(404).json({ message: (error as Error).message });
  }
}

/** The tide routes. */
export function createRoutes(options: RouterOptions = {}) {
  return createApiRouter(openapi, options, (router) => {
    router.get("/extremes", (req: Request, res: Response) => {
      res.json(
        getExtremesPrediction({
          ...positionOptions(req, { required: true }),
          ...predictionOptions(req),
          filter: hasTideModel,
        }),
      );
    });

    router.get("/timeline", (req: Request, res: Response) => {
      // Validate before the try so bad params surface as 400 {message, errors}
      // via the error handler, not the predictor's plain 400.
      const options = {
        ...positionOptions(req, { required: true }),
        ...predictionOptions(req),
        filter: hasTideModel,
      };
      try {
        res.json(getTimelinePrediction(options));
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    });

    router.get("/stations/:id", (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      if (!unprefixedIds.has(id))
        return res.status(404).json({ message: `Station not found: ${id}` });
      return show(id, res);
    });

    router.get("/stations/:source/:id", (req: Request, res: Response) =>
      show(`${req.params.source}/${req.params.id}`, res),
    );

    router.get("/stations", (req: Request, res: Response) => {
      const { latitude, longitude } = positionOptions(req);
      const query = validate.string(req.query, "query");
      const maxResults = validate.number(req.query, "maxResults", {
        integer: true,
        min: 1,
        max: 100,
        default: 10,
      });
      const maxDistance = validate.number(req.query, "maxDistance", { min: 0 });
      const bboxParam = validate.bbox(req.query);

      if (query) {
        return res.json(search(query, { filter: tideOnly, maxResults }).map(summarize));
      }

      if (bboxParam) {
        return res.json(bboxQuery(bboxParam, { filter: tideOnly }).map(summarize));
      }

      if (latitude === undefined || longitude === undefined) {
        return res.json(stations.filter(tideOnly).map(summarize));
      }

      res.json(
        stationsNear({ latitude, longitude, maxResults, maxDistance }).map((station) => ({
          ...station,
          ...availability(station),
        })),
      );
    });

    router.get("/stations/:source/:id/extremes", (req: Request, res: Response) => {
      let station: ReturnType<typeof findStation>;

      try {
        station = findStation(`${req.params.source}/${req.params.id}`);
      } catch (error) {
        return res.status(404).json({ message: (error as Error).message });
      }

      res.json(station.getExtremesPrediction(predictionOptions(req)));
    });

    router.get("/stations/:source/:id/timeline", (req: Request, res: Response) => {
      let station: ReturnType<typeof findStation>;

      try {
        station = findStation(`${req.params.source}/${req.params.id}`);
      } catch (error) {
        return res.status(404).json({ message: (error as Error).message });
      }

      res.json(station.getTimelinePrediction(predictionOptions(req)));
    });
  });
}

function positionOptions(
  req: Request,
  opts: { required: true },
): { latitude: number; longitude: number };
function positionOptions(
  req: Request,
  opts?: { required?: boolean },
): { latitude: number | undefined; longitude: number | undefined };
function positionOptions(req: Request, { required = false } = {}) {
  return {
    latitude: validate.number(req.query, "latitude", { required, min: -90, max: 90 }),
    longitude: validate.number(req.query, "longitude", { required, min: -180, max: 180 }),
  };
}

function predictionOptions(req: Request) {
  const datum = validate.datum(req.query);
  return {
    start: validate.date(req.query, "start", () => new Date()),
    end: validate.date(req.query, "end", () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    ...(datum && { datum }),
    units: validate.units(req.query),
  };
}

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
    // A list shows these stations' predictions, so it owes their credit and terms.
    attribution: station.attribution,
    license: station.license,
    ...availability(station),
  };
}
