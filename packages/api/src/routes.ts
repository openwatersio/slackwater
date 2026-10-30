import type { Request, Response } from "express";
import { loadStations, type Station } from "@slackwater/database";
import {
  getExtremesPrediction,
  getTimelinePrediction,
  findStation,
  stationsNear,
} from "slackwater";
import { loadOpenapi } from "./openapi.js";
import * as validate from "./validate.js";
import { createApiRouter, type RouterOptions } from "./router.js";
import { stationsInBounds } from "./bbox.js";

// The database also carries current stations, which createCurrentRoutes serves.
const tideOnly = (station: Station) => station.kind === "tide";
// CHS tide stations carry identity only, since CHS terms forbid re-serving its
// predictions; picking one by location would serve a flat zero tide.
const hasTideModel = (station: Station) =>
  station.harmonic_constituents.length > 0 || station.offsets !== undefined;

/** The tide routes. */
export function createRoutes(options: RouterOptions = {}) {
  return createApiRouter(loadOpenapi, options, (router) => {
    router.get("/extremes", async (req: Request, res: Response) => {
      res.json(
        await getExtremesPrediction({
          ...positionOptions(req, { required: true }),
          ...(await predictionOptions(req)),
          filter: hasTideModel,
        }),
      );
    });

    router.get("/timeline", async (req: Request, res: Response) => {
      // Validate before the try so bad params surface as 400 {message, errors}
      // via the error handler, not the predictor's plain 400.
      const options = {
        ...positionOptions(req, { required: true }),
        ...(await predictionOptions(req)),
        filter: hasTideModel,
      };
      try {
        res.json(await getTimelinePrediction(options));
      } catch (error) {
        res.status(400).json({ message: (error as Error).message });
      }
    });

    router.get("/stations/:source/:id", async (req: Request, res: Response) => {
      try {
        res.json(await findStation(`${req.params.source}/${req.params.id}`));
      } catch (error) {
        res.status(404).json({ message: (error as Error).message });
      }
    });

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
        res.json(db.search(query, { filter: tideOnly, maxResults }).map(stripStationDetails));
        return;
      }

      if (bboxParam) {
        res.json(stationsInBounds(db, bboxParam, tideOnly).map(stripStationDetails));
        return;
      }

      if (latitude === undefined || longitude === undefined) {
        res.json(db.accepted.filter(tideOnly).map(stripStationDetails));
        return;
      }

      res.json(
        await stationsNear({
          latitude,
          longitude,
          maxResults,
          maxDistance,
        }),
      );
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

function stripStationDetails(station: Station) {
  const { id, name, region, country, continent, latitude, longitude, timezone, type } = station;
  return { id, name, region, country, continent, latitude, longitude, timezone, type };
}
