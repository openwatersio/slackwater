import { json, Router, type RequestHandler, type ErrorRequestHandler } from "express";

export interface RouterOptions {
  /** Extra middleware run before the routes, e.g. OpenAPI validation in tests. */
  middleware?: RequestHandler[];
}

interface Spec {
  info: { title: string; version: string };
}

/**
 * A router for one route group: JSON parsing, `/` and `/openapi.json` for its
 * spec, the routes `define` adds, and an error handler that formats
 * `{ message, errors }` with the error's `status`.
 */
export function createApiRouter(
  spec: Spec,
  { middleware = [] }: RouterOptions,
  define: (router: Router) => void,
) {
  const router = Router();

  router.use(json());

  // Extra middleware runs in front of the error handler below, so its rejections are formatted too.
  for (const handler of middleware) router.use(handler);

  router.get("/", (req, res) => {
    res.json({
      name: spec.info.title,
      version: spec.info.version,
      docs: `${req.baseUrl}/openapi.json`,
    });
  });

  router.get("/openapi.json", (req, res) => {
    res.json({ ...spec, servers: [{ url: req.baseUrl || "/" }] });
  });

  define(router);

  router.use(((err, _req, res, _next) => {
    const status = err.status ?? 500;
    const message = err.message ?? "Unknown error";

    res.status(status).json({ message, errors: err.errors });
  }) satisfies ErrorRequestHandler);

  return router;
}
