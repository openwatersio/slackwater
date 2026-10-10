import { describe, test, expect } from "vitest";
import express from "express";
import request from "supertest";
import { middleware as openApiValidator } from "express-openapi-validator";
import { stations as dbStations } from "@slackwater/database";
import { createApp, createRoutes, openapi } from "../src/index.js";

// Every request and response is validated against the OpenAPI spec, as in index.test.ts.
const app = createApp({
  prefix: "/",
  middleware: openApiValidator({
    apiSpec: { ...openapi, servers: [{ url: "/" }] } as never,
    validateRequests: { coerceTypes: true },
    validateResponses: true,
  }),
});

const span = { start: "2026-06-01T00:00:00Z", end: "2026-06-02T00:00:00Z" };
// Deception Pass (Narrows), noaa/PUG1701.
const deceptionPass = { latitude: 48.406, longitude: -122.643 };
// Active Pass, a CHS station whose predictions can't be served.
const activePass = { latitude: 48.8604, longitude: -123.3128 };

type Event = { kind: string; speed: number; direction?: number };
type Summary = { id: string; predictions: boolean; bins: { id: string; bin?: number }[] };

describe("GET /currents/events", () => {
  test("returns events for the nearest current station", async () => {
    const response = await request(app)
      .get("/currents/events")
      .query({ ...deceptionPass, ...span });

    expect(response.status).toBe(200);
    expect(response.body.units).toBe("knots");
    expect(response.body.station.id).toBe("noaa/PUG1701");
    expect(response.body.station.predictions).toBe(true);
    expect(response.body.distance).toBeLessThan(1);
    expect(response.body.floodDirection).toBe(response.body.station.current.flood_direction);
    expect(response.body.ebbDirection).toBe(response.body.station.current.ebb_direction);

    const events: Event[] = response.body.events;
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(["slack", "maxFlood", "maxEbb"]));
    for (const event of events) {
      if (event.kind === "maxFlood") {
        expect(event.speed).toBeGreaterThan(0);
        expect(event.direction).toBe(response.body.floodDirection);
      }
      if (event.kind === "maxEbb") {
        expect(event.speed).toBeLessThan(0);
        expect(event.direction).toBe(response.body.ebbDirection);
      }
      if (event.kind === "slack") expect(event).not.toHaveProperty("direction");
    }
  });

  test("skips stations whose predictions can't be served", async () => {
    const response = await request(app)
      .get("/currents/events")
      .query({ ...activePass, ...span });

    expect(response.status).toBe(200);
    expect(response.body.station.source.name).not.toBe("Canadian Hydrographic Service");
    expect(response.body.station.predictions).toBe(true);
  });

  test("never resolves to a secondary bin", async () => {
    // noaa/ACT8851 and noaa/ACT8851@2 share a position, and an unfiltered nearest lookup picks @2.
    const station = dbStations.find((s) => s.id === "noaa/ACT8851")!;
    const response = await request(app)
      .get("/currents/events")
      .query({ latitude: station.latitude, longitude: station.longitude, ...span });

    expect(response.body.station.id).toBe("noaa/ACT8851");
  });

  test("defaults to the next 7 days", async () => {
    const response = await request(app).get("/currents/events").query(deceptionPass);

    expect(response.status).toBe(200);
    const times = response.body.events.map((e: { time: string }) => Date.parse(e.time));
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });

  test("returns 400 when end is not after start", async () => {
    const response = await request(app)
      .get("/currents/events")
      .query({ ...deceptionPass, start: span.end, end: span.start });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("end");
  });

  test("accepts a span of exactly 366 days", async () => {
    const response = await request(app)
      .get("/currents/stations/noaa/PUG1701/events")
      .query({ start: "2026-01-01T00:00:00Z", end: "2027-01-02T00:00:00Z" });

    expect(response.status).toBe(200);
  });

  test("returns 400 for a span longer than 366 days", async () => {
    const response = await request(app)
      .get("/currents/events")
      .query({ ...deceptionPass, start: "2026-01-01T00:00:00Z", end: "2027-01-03T00:00:00Z" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/366 days/);
  });

  test("returns 400 for missing coordinates", async () => {
    const response = await request(app).get("/currents/events").query(span);

    expect(response.status).toBe(400);
  });
});

describe("GET /currents/timeline", () => {
  test("returns a signed speed timeline for the nearest current station", async () => {
    const response = await request(app)
      .get("/currents/timeline")
      .query({ ...deceptionPass, ...span });

    expect(response.status).toBe(200);
    expect(response.body.units).toBe("knots");
    expect(response.body.station.id).toBe("noaa/PUG1701");
    expect(response.body.timeline).toHaveLength(145);
    const speeds = response.body.timeline.map((p: { speed: number }) => p.speed);
    expect(Math.min(...speeds)).toBeLessThan(0);
    expect(Math.max(...speeds)).toBeGreaterThan(0);
  });
});

describe("GET /currents/stations", () => {
  const isListed = (body: Summary[], id: string) => body.some((s) => s.id === id);

  test("lists every current station once, at its primary bin", async () => {
    const response = await request(app).get("/currents/stations");

    expect(response.status).toBe(200);
    const ids: string[] = response.body.map((s: Summary) => s.id);
    expect(ids.every((id) => !id.includes("@"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("noaa/EPT0003");
    const currentIds = new Set(dbStations.filter((s) => s.kind === "current").map((s) => s.id));
    expect(ids.every((id) => currentIds.has(id))).toBe(true);
  });

  test("lists a station's bins, primary first", async () => {
    const response = await request(app).get("/currents/stations").query({ query: "Estes Head" });

    expect(response.status).toBe(200);
    expect(isListed(response.body, "noaa/EPT0003@11")).toBe(false);
    const estes = response.body.find((s: Summary) => s.id === "noaa/EPT0003");
    expect(estes.bins).toEqual([{ id: "noaa/EPT0003" }, { id: "noaa/EPT0003@11", bin: 11 }]);
  });

  test("flags stations whose predictions can't be served", async () => {
    const response = await request(app).get("/currents/stations").query({ query: "Active Pass" });

    const chs = response.body.find((s: Summary) => s.id === "chs-active-pass");
    expect(chs.predictions).toBe(false);
    expect(chs.unavailable).toMatch(/Canadian Hydrographic Service/);
    expect(chs.unavailable).toMatch(/tides\.gc\.ca/);
  });

  test("flags stations with nothing to predict from", async () => {
    const response = await request(app).get("/currents/stations").query({ query: "Boundary Pass" });

    const boundary = response.body.find((s: Summary) => s.id === "noaa-boundary-pass");
    expect(boundary.predictions).toBe(false);
    expect(boundary.unavailable).toMatch(/no harmonic constituents or subordinate offsets/);
  });

  test("applies maxResults to query search results", async () => {
    const response = await request(app)
      .get("/currents/stations")
      .query({ query: "Pass", maxResults: 2 });

    expect(response.body).toHaveLength(2);
  });

  test("returns more than the search default of 20 when maxResults asks", async () => {
    const response = await request(app)
      .get("/currents/stations")
      .query({ query: "Pass", maxResults: 50 });

    expect(response.body).toHaveLength(50);
  });

  test("finds stations near coordinates", async () => {
    const response = await request(app)
      .get("/currents/stations")
      .query({ ...deceptionPass, maxResults: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);
    expect(response.body[0].id).toBe("noaa/PUG1701");
    expect(response.body[0].distance).toBeLessThan(1);
    expect(response.body[0].predictions).toBe(true);
  });

  test("respects maxDistance and skips secondary bins near coordinates", async () => {
    const response = await request(app)
      .get("/currents/stations")
      .query({ latitude: 44.88793, longitude: -66.99565, maxDistance: 1 });

    expect(response.body.map((s: Summary) => s.id)).toEqual(["noaa/EPT0003"]);
  });

  test("returns current stations within a bounding box", async () => {
    const response = await request(app)
      .get("/currents/stations")
      .query({ bbox: "-67.1,44.8,-66.9,45.0" });

    expect(response.status).toBe(200);
    expect(isListed(response.body, "noaa/EPT0003")).toBe(true);
    expect(isListed(response.body, "noaa/EPT0003@11")).toBe(false);
  });

  test("returns 400 for invalid bbox", async () => {
    const response = await request(app).get("/currents/stations").query({ bbox: "1,2,3" });

    expect(response.status).toBe(400);
  });
});

describe("GET /currents/stations/:source/:id", () => {
  test("returns the primary bin for a bare id", async () => {
    const response = await request(app).get("/currents/stations/noaa/EPT0003");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("noaa/EPT0003");
    expect(response.body.kind).toBe("current");
    expect(response.body.predictions).toBe(true);
    expect(response.body.bins).toHaveLength(2);
  });

  test("selects a bin with @N", async () => {
    const response = await request(app).get("/currents/stations/noaa/EPT0003@11");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("noaa/EPT0003@11");
    expect(response.body.bins).toEqual([
      { id: "noaa/EPT0003" },
      { id: "noaa/EPT0003@11", bin: 11 },
    ]);
  });

  test("returns 404 listing the available bins for an unknown bin", async () => {
    const response = await request(app).get("/currents/stations/noaa/EPT0003@99");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      "noaa/EPT0003 has no bin 99. Available: noaa/EPT0003, noaa/EPT0003@11",
    );
  });

  test("treats a zero-padded bin as a different id", async () => {
    const response = await request(app).get("/currents/stations/noaa/EPT0003@011");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Current station not found: noaa/EPT0003@011");
  });

  test("returns 404 for an unknown station", async () => {
    const response = await request(app).get("/currents/stations/noaa/NOPE");

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/not found/);
  });

  test("returns 404 for a bin of an unknown station", async () => {
    const response = await request(app).get("/currents/stations/noaa/NOPE@3");

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/not found/);
  });

  test("does not return tide stations", async () => {
    const response = await request(app).get("/currents/stations/noaa/8722588");

    expect(response.status).toBe(404);
  });
});

describe("GET /currents/stations/:source/:id/events", () => {
  test("returns events for a harmonic station", async () => {
    const response = await request(app).get("/currents/stations/noaa/PUG1701/events").query(span);

    expect(response.status).toBe(200);
    expect(response.body.station.id).toBe("noaa/PUG1701");
    expect(response.body).not.toHaveProperty("distance");
    expect(response.body.events.length).toBeGreaterThan(0);
  });

  test("predicts a selected bin from its own constituents", async () => {
    const primary = await request(app).get("/currents/stations/noaa/EPT0003/events").query(span);
    const bin = await request(app).get("/currents/stations/noaa/EPT0003@11/events").query(span);

    expect(bin.status).toBe(200);
    expect(bin.body.station.id).toBe("noaa/EPT0003@11");
    expect(bin.body.events).not.toEqual(primary.body.events);
  });

  test("returns only events inside start and end", async () => {
    const window = { start: "2026-06-01T12:00:00Z", end: "2026-06-01T18:00:00Z" };
    const response = await request(app).get("/currents/stations/noaa/PUG1701/events").query(window);

    expect(response.status).toBe(200);
    const times: number[] = response.body.events.map((e: { time: string }) => Date.parse(e.time));
    expect(times.length).toBeGreaterThan(0);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(Date.parse(window.start));
    expect(Math.max(...times)).toBeLessThanOrEqual(Date.parse(window.end));
  });

  test("returns events for a subordinate station", async () => {
    const response = await request(app).get("/currents/stations/noaa/PCT0236/events").query(span);

    expect(response.status).toBe(200);
    expect(response.body.station.type).toBe("subordinate");
    expect(response.body.events.some((e: Event) => e.kind === "maxFlood")).toBe(true);
  });

  test("omits directions the station doesn't define", async () => {
    // noaa/ACT3681 has a flood direction but no ebb direction.
    const response = await request(app).get("/currents/stations/noaa/ACT3681/events").query(span);

    expect(response.status).toBe(200);
    expect(response.body.floodDirection).toBe(10);
    expect(response.body).not.toHaveProperty("ebbDirection");
    const events: Event[] = response.body.events;
    expect(events.find((e) => e.kind === "maxFlood")?.direction).toBe(10);
    expect(events.find((e) => e.kind === "maxEbb")).not.toHaveProperty("direction");
  });

  test("omits both directions when the station has neither", async () => {
    const response = await request(app).get("/currents/stations/noaa/ACT5151/events").query(span);

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("floodDirection");
    expect(response.body.events.every((e: Event) => e.direction === undefined)).toBe(true);
  });

  test("returns 400 when end is not after start", async () => {
    const response = await request(app)
      .get("/currents/stations/noaa/PUG1701/events")
      .query({ start: span.end, end: span.start });

    expect(response.status).toBe(400);
  });

  test("returns 404 for an unknown station", async () => {
    const response = await request(app).get("/currents/stations/noaa/NOPE/events").query(span);

    expect(response.status).toBe(404);
  });
});

describe("GET /currents/stations/:source/:id/timeline", () => {
  test("returns a timeline for a station", async () => {
    const response = await request(app).get("/currents/stations/noaa/PUG1701/timeline").query(span);

    expect(response.status).toBe(200);
    expect(response.body.units).toBe("knots");
    expect(response.body.timeline).toHaveLength(145);
  });

  test("returns 404 for an unknown station", async () => {
    const response = await request(app).get("/currents/stations/noaa/NOPE/timeline").query(span);

    expect(response.status).toBe(404);
  });
});

describe("stations whose predictions can't be served", () => {
  test("returns a CHS station record by its unprefixed id", async () => {
    const response = await request(app).get("/currents/stations/chs-active-pass");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("chs-active-pass");
    expect(response.body.predictions).toBe(false);
  });

  test.each(["events", "timeline"])("refuses CHS %s with 451", async (kind) => {
    const response = await request(app)
      .get(`/currents/stations/chs-active-pass/${kind}`)
      .query(span);

    expect(response.status).toBe(451);
    expect(response.body.message).toMatch(/Canadian Hydrographic Service/);
    expect(response.body.message).toMatch(/tides\.gc\.ca/);
  });

  test("refuses a station with nothing to predict from with 404", async () => {
    const response = await request(app)
      .get("/currents/stations/noaa-boundary-pass/events")
      .query(span);

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/no harmonic constituents or subordinate offsets/);
  });

  test("returns 404 for an unknown unprefixed id", async () => {
    const response = await request(app).get("/currents/stations/nope");

    expect(response.status).toBe(404);
  });

  test.each(["PUG1701", "noaa%2FPUG1701"])(
    "does not resolve %s as a single segment",
    async (id) => {
      const response = await request(app).get(`/currents/stations/${id}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toMatch(/not found/);
    },
  );

  test("falls through to source/id when the first segment is not an unprefixed id", async () => {
    // Without the fall-through, this would look up a station named "noaa".
    const response = await request(app).get("/currents/stations/noaa/PUG1701");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("noaa/PUG1701");
    const events = await request(app).get("/currents/stations/noaa/events");
    expect(events.status).toBe(404);
    expect(events.body.message).toMatch(/noaa\/events/);
  });
});

describe("mounted with createRoutes", () => {
  const parent = express();
  parent.use("/api", createRoutes());

  test("serves currents under the mount path", async () => {
    const response = await request(parent).get("/api/currents/stations/noaa/PUG1701");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("noaa/PUG1701");
  });

  test("lists current paths in the OpenAPI document", async () => {
    const response = await request(parent).get("/api/openapi.json");

    expect(Object.keys(response.body.paths)).toContain("/currents/events");
  });
});
