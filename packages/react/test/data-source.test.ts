import { queryKeys } from "../src/query-keys.js";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
  createApiDataSource,
  resolveDataSource,
  type SlackwaterDataSource,
} from "../src/data-source.js";
import { currentTimelineQuery, currentEventsQuery } from "../src/hooks/use-current-station.js";
import { timelineQuery } from "../src/hooks/use-timeline.js";
import { extremesQuery } from "../src/hooks/use-extremes.js";
import { localSource } from "./local-source.js";

afterEach(() => vi.restoreAllMocks());

test("the API source has a stable URL key and retains client decoding", async () => {
  const source = createApiDataSource("https://api.example.com/");
  expect(source.cacheKey).toBe(createApiDataSource("https://api.example.com").cacheKey);
  const fetch = vi.spyOn(window, "fetch").mockResolvedValue(
    Response.json({
      units: "knots",
      station: { id: "noaa/channel@11" },
      timeline: [{ time: "2026-11-03T12:00:00Z", speed: 1 }],
    }),
  );
  const data = await source.getCurrentTimeline({
    id: "noaa/channel@11",
    start: "2026-11-03T00:00:00Z",
  });
  expect(data.timeline[0].time).toEqual(new Date("2026-11-03T12:00:00Z"));
  expect(fetch).toHaveBeenCalledWith(
    "https://api.example.com/currents/stations/noaa/channel@11/timeline?start=2026-11-03T00%3A00%3A00Z",
  );
});

test("all public prediction builders accept a local source without fetching", async () => {
  const source = localSource();
  const fetch = vi.spyOn(window, "fetch");
  const config = { dataSource: source, units: "feet" as const };
  await timelineQuery(config, { latitude: 48, longitude: -123, units: "meters" }).queryFn();
  expect(source.getTimeline).toHaveBeenCalledWith({
    latitude: 48,
    longitude: -123,
    units: "meters",
  });
  await extremesQuery(config, { id: "local/harbor" }).queryFn();
  expect(source.getExtremes).toHaveBeenCalledWith({ id: "local/harbor", units: "feet" });
  await currentTimelineQuery(source, "local/channel@11").queryFn();
  await currentEventsQuery(source, "local/channel@11").queryFn();
  expect(source.getCurrentTimeline).toHaveBeenCalledWith({ id: "local/channel@11" });
  expect(source.getCurrentEvents).toHaveBeenCalledWith({ id: "local/channel@11" });
  expect(fetch).not.toHaveBeenCalled();
});

test("query builders isolate identical requests by source", () => {
  const params = { id: "local/harbor" };
  const a = timelineQuery({ dataSource: localSource("a"), units: "feet" }, params);
  const b = timelineQuery({ dataSource: localSource("b"), units: "feet" }, params);
  expect(a.queryKey).not.toEqual(b.queryKey);
  expect(a.queryKey).toEqual(
    timelineQuery({ dataSource: localSource("a"), units: "feet" }, params).queryKey,
  );
});

test("different HTTP endpoints cannot share a prediction cache entry", () => {
  const params = { id: "noaa/9447130" };
  expect(
    timelineQuery({ baseUrl: "https://one.example", units: "feet" }, params).queryKey,
  ).not.toEqual(timelineQuery({ baseUrl: "https://two.example", units: "feet" }, params).queryKey);
});

test("distinct API mount paths keep distinct cache identities", () => {
  expect(createApiDataSource("https://api.example.com/mount//").cacheKey).not.toBe(
    createApiDataSource("https://api.example.com/mount/").cacheKey,
  );
});

test("missing data-source configuration is rejected explicitly", () => {
  expect(() => resolveDataSource(undefined)).toThrow("Supply baseUrl or dataSource");
});

test("the API source supports tide predictions by coordinates", async () => {
  const source = createApiDataSource("https://api.example.com/mounted");
  const fetch = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
    const event = { time: "2026-11-03T12:00:00Z", level: 2 };
    return Response.json(
      String(input).includes("/extremes")
        ? { extremes: [{ ...event, high: true, low: false, label: "High" }] }
        : { timeline: [event] },
    );
  });
  const params = { latitude: 48, longitude: -123, units: "meters" as const };
  const timeline = await source.getTimeline(params);
  const extremes = await source.getExtremes(params);
  expect(timeline.timeline[0].time).toBeInstanceOf(Date);
  expect(extremes.extremes[0].time).toBeInstanceOf(Date);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.example.com/mounted/tides/timeline?latitude=48&longitude=-123&units=meters",
    "https://api.example.com/mounted/tides/extremes?latitude=48&longitude=-123&units=meters",
  ]);
});

test.each([undefined, "", " ", 12])("invalid cache identities are rejected: %s", (cacheKey) => {
  const source = { ...localSource(), cacheKey } as unknown as SlackwaterDataSource;
  expect(() => resolveDataSource(source)).toThrow(/cacheKey/);
});

test("unscoped query keys remain usable as invalidation prefixes", () => {
  expect(queryKeys.station("local/harbor")).toEqual(["slackwater", "station", "local/harbor"]);
  expect(queryKeys.station("local/harbor", "local:v1").slice(0, 3)).toEqual(
    queryKeys.station("local/harbor"),
  );
});

test("a custom API identity is validated and does not expose a private URL", () => {
  expect(
    createApiDataSource("https://private.example/secret/", { cacheKey: "public:v1" }).cacheKey,
  ).toBe("public:v1");
  expect(() => createApiDataSource("https://api.example", { cacheKey: " " })).toThrow(/cacheKey/);
});

test("custom source keys cannot hydrate legacy current events into the revised query", async () => {
  const source = localSource("public-catalog:v3");
  const params = { id: "local/channel@11" };
  const legacy = { events: [{ kind: "maxEbb", speed: -0.03 }] };
  const client = new QueryClient();
  client.setQueryData(
    ["slackwater", "current-events", params, { source: source.cacheKey }],
    legacy,
  );
  try {
    const result = await client.fetchQuery({
      ...currentEventsQuery(source, params.id),
      staleTime: Infinity,
    });
    expect(source.getCurrentEvents).toHaveBeenCalledOnce();
    expect(result).not.toBe(legacy);
  } finally {
    client.clear();
  }
});

test("default API cache identities do not publish URL text and keep credentials isolated", () => {
  const a = createApiDataSource("https://user:secret@internal.example/private-path/");
  const b = createApiDataSource("https://user:other@internal.example/private-path/");
  expect(a.cacheKey).toMatch(/^api:minima-v1:[a-f0-9]{64}$/);
  expect(
    JSON.stringify(
      timelineQuery({ dataSource: a, units: "feet" }, { id: "noaa/9447130" }).queryKey,
    ),
  ).not.toMatch(/secret|internal|private-path/);
  expect(a.cacheKey).not.toBe(b.cacheKey);
});

test("empty station ids retain the coordinate fallback for HTTP tide requests", async () => {
  const fetch = vi
    .spyOn(window, "fetch")
    .mockImplementation(async (input) =>
      Response.json(String(input).includes("extremes") ? { extremes: [] } : { timeline: [] }),
    );
  const source = createApiDataSource("https://api.example.com");
  const params = { id: "", latitude: 48, longitude: -123 };
  await source.getTimeline(params);
  await source.getExtremes(params);
  expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/tides/timeline",
    "/tides/extremes",
  ]);
});
