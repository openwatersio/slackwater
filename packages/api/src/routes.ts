import {
  json,
  Router,
  Request,
  Response,
  type RequestHandler,
  type ErrorRequestHandler,
} from "express";
import { stations, Station, search, bbox as bboxQuery } from "@slackwater/database";
import {
  getExtremesPrediction,
  getTimelinePrediction,
  findStation,
  stationsNear,
} from "slackwater";
import openapi from "./openapi.js";
import * as validate from "./validate.js";
import { createCurrentRoutes } from "./currents.js";

// The database also carries current stations, which the /currents routes serve.
const tideOnly = (station: Station) => station.kind === "tide";
// CHS tide stations carry identity only, since CHS terms forbid re-serving its
// predictions; picking one by location would serve a flat zero tide.
const hasTideModel = (station: Station) =>
  station.harmonic_constituents.length > 0 || station.offsets !== undefined;

interface CreateRoutesOptions {
  middleware?: RequestHandler[];
}

export function createRoutes({ middleware = [] }: CreateRoutesOptions = {}) {
  const router = Router();

  router.use(json());

  // Extra middleware (e.g. spec validation in tests) runs before the routes and
  // in front of the error handler below, so its rejections are formatted too.
  for (const handler of middleware) router.use(handler);

  router.get("/", (req, res) => {
    res.json({
      name: openapi.info.title,
      version: openapi.info.version,
      docs: `${req.baseUrl}/openapi.json`,
    });
  });

  router.get("/openapi.json", (req, res) => {
    res.json({ ...openapi, servers: [{ url: req.baseUrl || "/" }] });
  });

  router.use("/currents", createCurrentRoutes());

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

  router.get("/stations/:source/:id", (req: Request, res: Response) => {
    try {
      return res.json(findStation(`${req.params.source}/${req.params.id}`));
    } catch (error) {
      return res.status(404).json({ message: (error as Error).message });
    }
  });

  router.get("/stations", (req: Request, res: Response) => {
    const { latitude, longitude } = positionOptions(req);
    const query = req.query.query as string | undefined;
    const maxResults = validate.number(req.query, "maxResults", {
      integer: true,
      min: 1,
      max: 100,
      default: 10,
    });
    const maxDistance = validate.number(req.query, "maxDistance", { min: 0 });
    const bboxParam = validate.bbox(req.query);

    if (query) {
      return res.json(search(query, { filter: tideOnly, maxResults }).map(stripStationDetails));
    }

    if (bboxParam) {
      return res.json(bboxQuery(bboxParam, { filter: tideOnly }).map(stripStationDetails));
    }

    if (latitude === undefined || longitude === undefined) {
      return res.json(stations.filter(tideOnly).map(stripStationDetails));
    }

    res.json(
      stationsNear({
        latitude,
        longitude,
        maxResults,
        maxDistance,
      }),
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

  router.use(((err, _req, res, next) => {
    if (!err) return next();

    const status = err.status ?? 500;
    const message = err.message ?? "Unknown error";

    res.status(status).json({ message, errors: err.errors });
  }) satisfies ErrorRequestHandler);

  return router;
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

function stripStationDetails(station: Station) {
  const { id, name, region, country, continent, latitude, longitude, timezone, type } = station;
  return { id, name, region, country, continent, latitude, longitude, timezone, type };
}
