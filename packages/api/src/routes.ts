import type { Request, Response } from "express";
import { loadStations, type Station, type StationDatabase } from "@slackwater/database";
import {
  getExtremesPrediction,
  getTimelinePrediction,
  findStation,
  stationsNear,
  currentStationUnavailableIn,
} from "slackwater";
import { loadOpenapi } from "./openapi.js";
import * as validate from "./validate.js";
import { createApiRouter, type RouterOptions } from "./router.js";
import { stationsInBounds } from "./bbox.js";

// CHS tide stations carry identity only, since CHS terms forbid re-serving its
// predictions; picking one by location would serve a flat zero tide.
type ModelFields = { harmonic_constituents: unknown[]; offsets?: unknown };
const hasTideModel = (station: ModelFields) =>
  station.harmonic_constituents.length > 0 || station.offsets !== undefined;

// The database also carries current stations, which createCurrentRoutes serves.
// A listing only offers stations this API can predict and route to.
const tideOnly = (station: Station) => station.kind === "tide" && hasTideModel(station);

/** Whether these routes can predict the station, and why not when they can't. */
function availability(
  db: StationDatabase,
  station: Parameters<typeof currentStationUnavailableIn>[1] & ModelFields,
) {
  if (hasTideModel(station)) return { predictions: true };
  return { predictions: false, unavailable: currentStationUnavailableIn(db, station)!.message };
}

async function show(id: string, res: Response) {
  try {
    const station = await findStation(id);
    return res.json({ ...station, ...availability(await loadStations(), station) });
  } catch (error) {
    return res.status(404).json({ message: (error as Error).message });
  }
}

/** The tide routes. */
export function createRoutes(options: RouterOptions = {}) {
  return createApiRouter(loadOpenapi, options, (router) => {
    router.get("/extremes", async (req: Request, res: Response) => {
      res.json(
        await getExtremesPrediction({
          ...positionOptions(req, { required: true }),
          ...(await predictionOptions(req)),
        }),
      );
    });

    router.get("/timeline", async (req: Request, res: Response) => {
      // Validate before the try so bad params surface as 400 {message, errors}
      // via the error handler, not the predictor's plain 400.
      const options = {
        ...positionOptions(req, { required: true }),
        ...(await predictionOptions(req)),
      };
      try {
        res.json(await getTimelinePrediction(options));
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    });

    router.get("/stations/:id", async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const db = await loadStations();
      if (id.includes("/") || !db.accepted.some((s) => s.kind === "tide" && s.id === id))
        return res.status(404).json({ message: `Station not found: ${id}` });
      return show(id, res);
    });

    router.get("/stations/:source/:id", (req: Request, res: Response) =>
      show(`${req.params.source}/${req.params.id}`, res),
    );

    router.get("/stations", async (req: Request, res: Response) => {
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
      const db = await loadStations();

      if (query) {
        res.json(
          db
            .search(query, { filter: tideOnly, maxResults })
            .map((station) => summarize(db, station)),
        );
        return;
      }

      if (bboxParam) {
        res.json(
          stationsInBounds(db, bboxParam, tideOnly).map((station) => summarize(db, station)),
        );
        return;
      }

      if (latitude === undefined || longitude === undefined) {
        res.json(db.accepted.filter(tideOnly).map((station) => summarize(db, station)));
        return;
      }

      const nearby = await stationsNear({ latitude, longitude, maxResults, maxDistance });
      res.json(nearby.map((station) => ({ ...station, ...availability(db, station) })));
    });

    router.get("/stations/:source/:id/extremes", async (req: Request, res: Response) => {
      let station: Awaited<ReturnType<typeof findStation>>;

      try {
        station = await findStation(`${req.params.source}/${req.params.id}`);
      } catch (error) {
        res.status(404).json({ message: (error as Error).message });
        return;
      }

      res.json(station.getExtremesPrediction(await predictionOptions(req)));
    });

    router.get("/stations/:source/:id/timeline", async (req: Request, res: Response) => {
      let station: Awaited<ReturnType<typeof findStation>>;

      try {
        station = await findStation(`${req.params.source}/${req.params.id}`);
      } catch (error) {
        res.status(404).json({ message: (error as Error).message });
        return;
      }

      res.json(station.getTimelinePrediction(await predictionOptions(req)));
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

async function predictionOptions(req: Request) {
  const { datums } = await loadStations();
  const datum = validate.datum(req.query, datums);
  return {
    start: validate.date(req.query, "start", () => new Date()),
    end: validate.date(req.query, "end", () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    ...(datum && { datum }),
    units: validate.units(req.query),
  };
}

function summarize(db: StationDatabase, station: Station) {
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
    attribution: station.attribution,
    license: station.license,
    ...availability(db, station),
  };
}
