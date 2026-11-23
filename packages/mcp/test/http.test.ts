import { expect, test } from "vitest";
import { handleRequest } from "../src/http.js";
import worker from "../src/worker.js";
import { Catalog } from "../src/catalog.js";
import { buildCatalog } from "../src/generate.js";
import { station, versions } from "./fixtures.js";

const built = buildCatalog([station()], versions);
const catalog = new Catalog(built.index, async (id) => built.models.get(id));
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
function request(body = list, extra: RequestInit = {}) {
  return new Request("http://localhost/mcp", { method: "POST", headers, body, ...extra });
}

test("HTTP exposes stateless discovery and browser preflight without public assets", async () => {
  const response = await handleRequest(catalog, request());
  expect(response.status).toBe(200);
  expect(((await response.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(
    5,
  );
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const preflight = await handleRequest(
    catalog,
    new Request("http://localhost/mcp", { method: "OPTIONS" }),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-headers")).toContain("Mcp-Protocol-Version");
  for (const path of [
    "/stations/test/port.json",
    "/stations/test%2Fport%402.json",
    "/stations/test%252Fport.json",
  ])
    expect((await handleRequest(catalog, new Request(`http://localhost${path}`))).status).toBe(404);
  expect(
    (await handleRequest(catalog, new Request("http://localhost/mcp", { method: "DELETE" })))
      .status,
  ).toBe(405);
});
test("HTTP rejects oversized bodies with and without Content-Length", async () => {
  expect((await handleRequest(catalog, request(" ".repeat(16385)))).status).toBe(413);
  expect(
    (
      await handleRequest(
        catalog,
        request("{}", { headers: { ...headers, "content-length": "20000" } }),
      )
    ).status,
  ).toBe(413);
  expect((await handleRequest(catalog, request("{"))).status).toBe(400);
});
test("rate limit refusal supplies retry and CORS headers", async () => {
  const response = await handleRequest(catalog, request(), { rateLimit: async () => false });
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});
test("the Worker reads one versioned manifest and only selected private model assets", async () => {
  const index = { ...built.index, files: { "test/port": "v/stations/test.json" } };
  const reads: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        reads.push(path);
        return Response.json(path === "/index.json" ? index : built.models.get("test/port"));
      },
    },
  };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_tide_prediction",
      arguments: {
        station_id: "test/port",
        start: "2026-11-10T08:00:00Z",
        end: "2026-11-11T08:00:00Z",
      },
    },
  });
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request(body), env);
    expect(
      ((await response.json()) as { result: { structuredContent: { events: unknown[] } } }).result
        .structuredContent.events,
    ).toHaveLength(4);
  }
  expect(reads).toEqual(["/index.json", "/v/stations/test.json", "/v/stations/test.json"]);
});

test("health, empty bodies, notifications and minimal logs preserve the transport contract", async () => {
  expect(
    await (await handleRequest(catalog, new Request("http://localhost/health"))).json(),
  ).toMatchObject({ status: "ok", versions });
  expect(
    (await handleRequest(catalog, new Request("http://localhost/mcp", { method: "POST", headers })))
      .status,
  ).toBe(400);
  const log: unknown[] = [];
  const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const response = await handleRequest(catalog, request(notification), {
    rateLimit: async () => true,
    log: (entry) => log.push(entry),
  });
  expect(response.status).toBe(202);
  expect(await response.text()).toBe("");
  expect(log).toMatchObject([{ tool: null, status: 202, version: versions.server }]);
  await handleRequest(
    catalog,
    request(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_station", arguments: { station_id: "test/port" } },
      }),
    ),
    { log: (entry) => log.push(entry) },
  );
  expect(log[1]).toMatchObject({ tool: "get_station", status: 200 });
  expect(JSON.stringify(log)).not.toContain("test/port");
});

test("the serialized response ceiling applies to the whole JSON-RPC message", async () => {
  const index = { ...built.index, versions: { ...versions, server: "x".repeat(270000) } };
  const large = new Catalog(index, async (id) => built.models.get(id));
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  expect((await handleRequest(large, request(initialize))).status).toBe(413);
});

test("Worker errors fail closed, retry manifest loads and enforce the limiter", async () => {
  let attempts = 0;
  const assets = {
    fetch: async (_request: Request) => {
      attempts++;
      return attempts === 1
        ? new Response("unavailable", { status: 503 })
        : Response.json({ ...built.index, files: { "test/port": "missing.json" } });
    },
  };
  const env = { ASSETS: assets, RATE_LIMITER: { limit: async () => ({ success: false }) } };
  expect((await worker.fetch(new Request("http://localhost/stations/test.json"), env)).status).toBe(
    404,
  );
  expect((await worker.fetch(request(), env)).status).toBe(503);
  expect((await worker.fetch(request(), env)).status).toBe(429);
  expect(attempts).toBe(2);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "get_tide_prediction",
      arguments: {
        station_id: "test/port",
        start: "2026-11-10T08:00:00Z",
        end: "2026-11-11T08:00:00Z",
      },
    },
  });
  const absent = {
    ASSETS: {
      fetch: async (r: Request) =>
        new URL(r.url).pathname === "/index.json"
          ? Response.json({ ...built.index, files: { "test/port": "missing.json" } })
          : new Response("missing", { status: 404 }),
    },
  };
  expect(
    ((await (await worker.fetch(request(body), absent)).json()) as { result: { isError: boolean } })
      .result.isError,
  ).toBe(true);
  const noFile = { ASSETS: { fetch: async () => Response.json(built.index) } };
  expect(
    ((await (await worker.fetch(request(body), noFile)).json()) as { result: { isError: boolean } })
      .result.isError,
  ).toBe(true);
});

test("batch requests cannot multiply prediction work under one rate limit check", async () => {
  let reads = 0;
  const c = new Catalog(built.index, async () => {
    reads++;
    return station();
  });
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_station", arguments: { station_id: "test/port", diagnostics: true } },
  };
  expect((await handleRequest(c, request(JSON.stringify([call, { ...call, id: 2 }])))).status).toBe(
    400,
  );
  expect(reads).toBe(0);
});
