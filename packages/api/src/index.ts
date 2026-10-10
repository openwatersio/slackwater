import express, { type RequestHandler } from "express";
import compression from "compression";
import { createHash } from "node:crypto";
import { createRoutes } from "./routes.js";
import { createCurrentRoutes } from "./currents.js";
import openapi, { currentsOpenapi } from "./openapi.js";
import pkg from "../package.json" with { type: "json" };
import cors from "cors";

const MAX_AGE = Number(process.env.SLACKWATER_API_MAX_AGE ?? 3600);
const CORS_ORIGIN = process.env.SLACKWATER_API_CORS_ORIGIN ?? "*";

interface CreateAppOptions {
  /** Path the tide routes are mounted at. */
  prefix?: string;
  /** Path the current routes are mounted at. */
  currentsPrefix?: string;
  compress?: boolean;
  /**
   * Extra middleware mounted before the tide routes. Used by tests to mount
   * express-openapi-validator (which relies on Ajv codegen and so can't run on
   * edge runtimes) and enforce request/response conformance to the OpenAPI spec.
   */
  middleware?: RequestHandler[];
  /** Extra middleware mounted before the current routes, as `middleware` is for tides. */
  currentsMiddleware?: RequestHandler[];
}

export function createApp({
  prefix = "/tides",
  currentsPrefix = "/currents",
  compress = true,
  middleware = [],
  currentsMiddleware = [],
}: CreateAppOptions = {}) {
  // Express matches paths case-insensitively and ignores a trailing slash.
  const tides = prefix.replace(/\/+$/, "").toLowerCase();
  const currents = currentsPrefix.replace(/\/+$/, "").toLowerCase();
  // Currents mount first, so a currentsPrefix that equals or contains prefix would shadow the tide
  // routes. A root currentsPrefix ("" once trimmed) contains every prefix.
  if (currents === "" || tides === currents || tides.startsWith(`${currents}/`)) {
    throw new Error(
      `currentsPrefix "${currentsPrefix}" must not equal or contain prefix "${prefix}"`,
    );
  }
  const app = express();

  // Configure CORS
  app.use(
    cors({
      origin: CORS_ORIGIN,
      credentials: true,
      optionsSuccessStatus: 200,
    }),
  );

  // Cache-Control middleware
  app.use((_req, res, next) => {
    // s-maxage lets CDNs (e.g. Vercel's edge) cache responses, not just browsers
    res.setHeader("Cache-Control", `public, max-age=${MAX_AGE}, s-maxage=${MAX_AGE}`);
    next();
  });

  // Configure ETag generation to include package version
  app.set("etag", (body: Buffer | string, encoding: BufferEncoding) => {
    const bodyString = typeof body === "string" ? body : body.toString(encoding);
    const hash = createHash("sha256")
      .update(pkg.version + bodyString, "utf8")
      .digest("hex")
      .substring(0, 27);
    return `W/"${hash}"`;
  });

  // Opt-out: compression() corrupts responses through the node:http bridge on
  // edge runtimes (e.g. Cloudflare Workers), which compress at the edge anyway.
  if (compress) app.use(compression());
  // Currents go first: with `prefix: "/"` the tide routes, and any tide-spec
  // validator in `middleware`, would otherwise see requests for current routes.
  app.use(currentsPrefix, createCurrentRoutes({ middleware: currentsMiddleware }));
  app.use(prefix, createRoutes({ middleware }));
  return app;
}

export { createRoutes, createCurrentRoutes, openapi, currentsOpenapi };
