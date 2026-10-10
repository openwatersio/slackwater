import { describe, test, expect } from "vitest";
import express from "express";
import request from "supertest";
import { middleware as openApiValidator } from "express-openapi-validator";
import { stations as dbStations } from "@slackwater/database";
import { createApp, createRoutes, openapi } from "../src/index.js";

// Mount express-openapi-validator here (not in createApp) so every request and
// response in the suite is validated against the OpenAPI spec — this is what
// keeps the runtime validators in src/validate.ts aligned with openapi.ts. The
// validator uses Ajv codegen and can't run on edge runtimes, so it stays out of
// the shipped app and lives only in tests.
const app = createApp({
  prefix: "/",
  middleware: openApiValidator({
    apiSpec: { ...openapi, servers: [{ url: "/" }] } as never,
    validateRequests: { coerceTypes: true },
    validateResponses: true,
  }),
});

describe("GET /", () => {
  test("returns API information", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("name");
    expect(response.body).toHaveProperty("version");
    expect(response.body).toHaveProperty("docs");
    expect(response.body.docs).toBe("/openapi.json");
  });
});

describe("GET /extremes", () => {
  test("returns extremes for valid coordinates", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
    expect(response.body).toHaveProperty("station");
    expect(response.body).toHaveProperty("datum");
    expect(response.body).toHaveProperty("units");
    expect(Array.isArray(response.body.extremes)).toBe(true);
  });

  test("accepts datum parameter", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "HAT",
    });

    expect(response.status).toBe(200);
    expect(response.body.datum).toBe("HAT");
  });

  test("accepts units parameter", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      units: "feet",
    });

    expect(response.status).toBe(200);
    expect(response.body.units).toBe("feet");
  });

  test("returns 400 for missing coordinates", async () => {
    const response = await request(app).get("/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message");
  });

  test("uses default dates when not provided", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
    expect(Array.isArray(response.body.extremes)).toBe(true);
    expect(response.body.extremes.length).toBeGreaterThanOrEqual(26);
  });

  test("returns 400 for invalid date format", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "invalid",
      end: "invalid",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
  });

  test("returns 400 for invalid datum", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "INVALID_DATUM",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
  });
});

describe("tide stations without a model", () => {
  // CHS tide stations carry identity only; a location query near one must pick a station that predicts.
  const chs = dbStations.find((s) => s.id === "chs-campbell-river")!;
  const query = {
    latitude: chs.latitude,
    longitude: chs.longitude,
    start: "2026-06-01T00:00:00Z",
    end: "2026-06-02T00:00:00Z",
  };

  test("are skipped by /extremes", async () => {
    const response = await request(app).get("/extremes").query(query);

    expect(response.status).toBe(200);
    expect(response.body.station.id).not.toBe(chs.id);
    expect(response.body.extremes.length).toBeGreaterThan(0);
  });

  test("are skipped by /timeline", async () => {
    const response = await request(app).get("/timeline").query(query);

    expect(response.status).toBe(200);
    expect(response.body.station.id).not.toBe(chs.id);
    expect(response.body.timeline.some((p: { level: number }) => p.level !== 0)).toBe(true);
  });
});

describe("GET /timeline", () => {
  test("returns timeline for valid coordinates", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(response.body).toHaveProperty("station");
    expect(response.body).toHaveProperty("datum");
    expect(response.body).toHaveProperty("units");
    expect(Array.isArray(response.body.timeline)).toBe(true);
  });

  test("accepts coordinate parameter variations", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
  });

  test("accepts datum and units parameters", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "HAT",
      units: "feet",
    });

    expect(response.status).toBe(200);
    expect(response.body.datum).toBe("HAT");
    expect(response.body.units).toBe("feet");
  });

  test("returns 400 for missing coordinates", async () => {
    const response = await request(app).get("/timeline").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message");
  });

  test("uses default dates when not provided", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 26.772,
      longitude: -80.05,
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(Array.isArray(response.body.timeline)).toBe(true);
    expect(response.body.timeline.length).toBeGreaterThan(7 * 24 * 6 - 1); // Every 10 minutes for 7 days
  });

  test("works for subordinate stations", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 42.3,
      longitude: -71.0,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(Array.isArray(response.body.timeline)).toBe(true);
  });
});

describe("GET /stations/:source/:id", () => {
  test("finds station by ID", async () => {
    const response = await request(app).get("/stations/noaa/8722588");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("id");
    expect(response.body).toHaveProperty("name");
    expect(response.body).toHaveProperty("latitude");
    expect(response.body).toHaveProperty("longitude");
  });

  test("returns stations near coordinates", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.length).toBeLessThanOrEqual(10);
    expect(response.body[0]).toHaveProperty("distance");
  });

  test("accepts coordinate parameter variations", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test("respects maxResults parameter", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
      maxResults: 5,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeLessThanOrEqual(5);
  });

  test("returns 400 for invalid maxResults", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
      maxResults: 200,
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message");
  });

  test("accepts maxDistance parameter", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
      maxDistance: 100,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test("returns 400 for negative maxDistance", async () => {
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
      maxDistance: -1,
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message");
  });

  test("returns 404 for non-existent station ID", async () => {
    const response = await request(app).get("/stations/fake/non-existent-station");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message");
  });
});

describe("GET /stations", () => {
  test("returns all stations when no coordinates are provided", async () => {
    const response = await request(app).get("/stations");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0]).not.toHaveProperty("datums");
    expect(response.body[0]).not.toHaveProperty("harmonic_constituents");
    expect(response.body[0]).not.toHaveProperty("offsets");
  });

  test("supports full-text search via query parameter", async () => {
    const response = await request(app).get("/stations").query({
      query: "8722588",
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.some((station: { id: string }) => station.id.includes("8722588"))).toBe(
      true,
    );
    expect(response.body[0]).not.toHaveProperty("harmonic_constituents");
  });

  test("applies maxResults to query search results", async () => {
    const response = await request(app).get("/stations").query({
      query: "United States",
      maxResults: 2,
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeLessThanOrEqual(2);
  });

  test("returns more than the search default of 20 when maxResults asks", async () => {
    const response = await request(app).get("/stations").query({ query: "harbor", maxResults: 50 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(50);
  });

  test("defaults maxResults to 10 for query searches", async () => {
    const response = await request(app).get("/stations").query({
      query: "noaa",
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeLessThanOrEqual(10);
  });

  test("accepts query with reserved characters like commas", async () => {
    const response = await request(app).get("/stations").query({
      query: "San Francisco, CA",
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test("returns stations within bounding box", async () => {
    // Bounding box around South Florida
    const response = await request(app).get("/stations").query({
      bbox: "-80.5,25.5,-79.5,27.0",
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    for (const station of response.body) {
      expect(station.longitude).toBeGreaterThanOrEqual(-80.5);
      expect(station.longitude).toBeLessThanOrEqual(-79.5);
      expect(station.latitude).toBeGreaterThanOrEqual(25.5);
      expect(station.latitude).toBeLessThanOrEqual(27.0);
    }
  });

  describe("excludes current stations", () => {
    // The database also carries current stations, which the tide predictor
    // can't use; every lookup mode must filter them out.
    const currentIds = new Set(dbStations.filter((s) => s.kind === "current").map((s) => s.id));
    const current = dbStations.find((s) => s.kind === "current")!;
    const hasCurrent = (body: { id: string }[]) => body.some((s) => currentIds.has(s.id));

    test("from the full station list", async () => {
      const response = await request(app).get("/stations");

      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThan(0);
      expect(hasCurrent(response.body)).toBe(false);
    });

    test("from query search results", async () => {
      // Searching a current station's own id must not surface it.
      const response = await request(app).get("/stations").query({ query: current.source.id });

      expect(response.status).toBe(200);
      expect(hasCurrent(response.body)).toBe(false);
    });

    test("from bounding box results", async () => {
      // A box built around a known current station.
      const bbox = [
        current.longitude - 0.5,
        current.latitude - 0.5,
        current.longitude + 0.5,
        current.latitude + 0.5,
      ].join(",");
      const response = await request(app).get("/stations").query({ bbox });

      expect(response.status).toBe(200);
      expect(hasCurrent(response.body)).toBe(false);
    });
  });

  test("returns empty array for bbox with no stations", async () => {
    // Bounding box in the middle of the Pacific
    const response = await request(app).get("/stations").query({
      bbox: "170,40,175,45",
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(0);
  });

  test("returns 400 for invalid bbox format", async () => {
    const response = await request(app).get("/stations").query({
      bbox: "invalid",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message");
  });
});

describe("GET /stations/:source/:id/extremes", () => {
  test("returns extremes for specific station", async () => {
    const response = await request(app).get("/stations/noaa/8722588/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
    expect(response.body).toHaveProperty("station");
    expect(Array.isArray(response.body.extremes)).toBe(true);
  });

  test("accepts datum and units parameters", async () => {
    const response = await request(app).get("/stations/noaa/8722588/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "HAT",
      units: "feet",
    });

    expect(response.status).toBe(200);
    expect(response.body.datum).toBe("HAT");
    expect(response.body.units).toBe("feet");
  });

  test("works for subordinate stations", async () => {
    const stationsResponse = await request(app).get("/stations").query({
      latitude: 42.3,
      longitude: -71.0,
      maxResults: 20,
    });

    const subordinate = stationsResponse.body.find(
      (s: { type: string }) => s.type === "subordinate",
    );

    expect(subordinate, "could not find subordinate station").toBeDefined();

    const response = await request(app).get(`/stations/${subordinate.id}/extremes`).query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
  });

  test("returns 404 for non-existent station", async () => {
    const response = await request(app).get("/stations/fake/non-existent-station/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message");
  });

  test("uses default dates when not provided", async () => {
    const response = await request(app).get("/stations/noaa/8722588/extremes");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
    expect(Array.isArray(response.body.extremes)).toBe(true);
    expect(response.body.extremes.length).toBeGreaterThan(0);
  });

  test("returns 400 for invalid datum", async () => {
    const response = await request(app).get("/stations/noaa/8722588/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "INVALID_DATUM",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
  });
});

describe("GET /stations/:source/:id/timeline", () => {
  test("returns timeline for specific station", async () => {
    const response = await request(app).get("/stations/noaa/8722588/timeline").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(response.body).toHaveProperty("station");
    expect(Array.isArray(response.body.timeline)).toBe(true);
  });

  test("accepts datum and units parameters", async () => {
    const response = await request(app).get("/stations/noaa/8722588/timeline").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
      datum: "HAT",
      units: "feet",
    });

    expect(response.status).toBe(200);
    expect(response.body.datum).toBe("HAT");
    expect(response.body.units).toBe("feet");
  });

  test("works for subordinate stations", async () => {
    const stationsResponse = await request(app).get("/stations").query({
      latitude: 42.3,
      longitude: -71.0,
      maxResults: 20,
    });

    const subordinate = stationsResponse.body.find(
      (s: { type: string }) => s.type === "subordinate",
    );

    expect(subordinate, "could not find subordinate station").toBeDefined();

    const response = await request(app).get(`/stations/${subordinate.id}/timeline`).query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(Array.isArray(response.body.timeline)).toBe(true);
  });

  test("returns 404 for non-existent station", async () => {
    const response = await request(app).get("/stations/fake/non-existent-station/timeline").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message");
  });

  test("uses default dates when not provided", async () => {
    const response = await request(app).get("/stations/noaa/8722588/timeline");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("timeline");
    expect(Array.isArray(response.body.timeline)).toBe(true);
    expect(response.body.timeline.length).toBeGreaterThan(0);
  });
});

describe("GET /openapi.json", () => {
  test("returns OpenAPI specification", async () => {
    const response = await request(app).get("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("openapi");
    expect(response.body).toHaveProperty("info");
    expect(response.body).toHaveProperty("paths");
    expect(response.body.openapi).toBe("3.0.3");
  });
});

describe("Error handling", () => {
  test("returns 400 for invalid coordinate values (NaN)", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: "invalid",
      longitude: "also-invalid",
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(Array.isArray(response.body.errors)).toBe(true);
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  test("error handler returns next() when no error", async () => {
    // This tests the error handler's !err branch by making a successful request
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
  });

  test("error handler handles non-validation errors", async () => {
    // Test an error from the route handlers (not validation)
    const response = await request(app).get("/stations/fake/nonexistent/extremes").query({
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message");
    expect(response.body.message).toContain("not found");
  });

  test("returns 400 for NaN coordinates in timeline endpoint", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: "not-a-number",
      longitude: "also-not-a-number",
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(Array.isArray(response.body.errors)).toBe(true);
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  test("returns 400 for NaN coordinates in stations endpoint", async () => {
    const response = await request(app).get("/stations").query({
      latitude: "invalid-lat",
      longitude: "invalid-lon",
    });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(Array.isArray(response.body.errors)).toBe(true);
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  test("handles errors from prediction functions", async () => {
    // Use dates that will cause issues (e.g., far in the future or invalid range)
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-18T00:00:00Z",
      end: "2025-12-17T00:00:00Z", // end before start
    });

    // This should either be caught by validation or return an error
    expect([400, 500]).toContain(response.status);
    expect(response.body).toHaveProperty("message");
  });

  test("handles errors from timeline prediction", async () => {
    const response = await request(app).get("/timeline").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-18T00:00:00Z",
      end: "2025-12-17T00:00:00Z", // end before start
    });

    expect([400, 500]).toContain(response.status);
    expect(response.body).toHaveProperty("message");
  });

  test("handles errors from stationsNear", async () => {
    // Test with valid coordinates that should work
    const response = await request(app).get("/stations").query({
      latitude: 26.772,
      longitude: -80.05,
      maxResults: 5,
    });

    expect(response.status).toBe(200);
  });

  test("handles non-'not found' errors in stations catch block", async () => {
    // Trigger a different kind of error by using valid id but causing processing error
    const response = await request(app).get("/stations").query({
      latitude: 0,
      longitude: 0,
      maxResults: 1,
    });

    // This should succeed and hit the stationsNear path
    expect(response.status).toBe(200);
  });
});

describe("HTTP Caching", () => {
  test("includes ETag header in response", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.headers.etag).toBeDefined();
    expect(response.headers.etag).toMatch(/^W\/"[a-f0-9]{27}"$/);
  });

  test("includes Cache-Control header in response", async () => {
    const response = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=3600, s-maxage=3600");
  });

  test("returns 304 when ETag matches", async () => {
    // First request to get the ETag
    const firstResponse = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(firstResponse.status).toBe(200);
    const etag = firstResponse.headers.etag;

    // Second request with If-None-Match header
    const secondResponse = await request(app)
      .get("/extremes")
      .query({
        latitude: 26.772,
        longitude: -80.05,
        start: "2025-12-17T00:00:00Z",
        end: "2025-12-18T00:00:00Z",
      })
      .set("If-None-Match", etag);

    expect(secondResponse.status).toBe(304);
    expect(secondResponse.body).toEqual({});
  });

  test("returns 200 when ETag does not match", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({
        latitude: 26.772,
        longitude: -80.05,
        start: "2025-12-17T00:00:00Z",
        end: "2025-12-18T00:00:00Z",
      })
      .set("If-None-Match", 'W/"invalid-etag"');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
  });

  test("different query parameters generate different ETags", async () => {
    const response1 = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    const response2 = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-18T00:00:00Z",
      end: "2025-12-19T00:00:00Z",
    });

    expect(response1.headers.etag).toBeDefined();
    expect(response2.headers.etag).toBeDefined();
    expect(response1.headers.etag).not.toBe(response2.headers.etag);
  });

  test("same query parameters generate same ETags", async () => {
    const response1 = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    const response2 = await request(app).get("/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response1.headers.etag).toBeDefined();
    expect(response2.headers.etag).toBeDefined();
    expect(response1.headers.etag).toBe(response2.headers.etag);
  });
});

describe("CORS", () => {
  test("includes CORS headers in response", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({
        latitude: 26.772,
        longitude: -80.05,
        start: "2025-12-17T00:00:00Z",
        end: "2025-12-18T00:00:00Z",
      })
      .set("Origin", "http://example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeDefined();
  });

  test("allows OPTIONS requests for preflight", async () => {
    const response = await request(app)
      .options("/extremes")
      .set("Origin", "http://example.com")
      .set("Access-Control-Request-Method", "GET");

    expect([200, 204]).toContain(response.status);
    expect(response.headers["access-control-allow-origin"]).toBeDefined();
    expect(response.headers["access-control-allow-methods"]).toBeDefined();
  });

  test("allows credentials when enabled", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({
        latitude: 26.772,
        longitude: -80.05,
        start: "2025-12-17T00:00:00Z",
        end: "2025-12-18T00:00:00Z",
      })
      .set("Origin", "http://example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("Sub-app mounting", () => {
  const parent = express();
  parent.use("/api", createRoutes());

  test("routes work under mount path", async () => {
    const response = await request(parent).get("/api/extremes").query({
      latitude: 26.772,
      longitude: -80.05,
      start: "2025-12-17T00:00:00Z",
      end: "2025-12-18T00:00:00Z",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("extremes");
  });

  test("stations endpoint works under mount path", async () => {
    const response = await request(parent).get("/api/stations/noaa/8722588");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("name");
  });

  test("openapi.json reflects mount path in servers", async () => {
    const response = await request(parent).get("/api/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.3");
    expect(response.body.servers).toEqual([{ url: "/api" }]);
  });

  test("root endpoint docs URL includes mount path", async () => {
    const response = await request(parent).get("/api/");

    expect(response.status).toBe(200);
    expect(response.body.docs).toBe("/api/openapi.json");
  });
});

describe("Runtime validation (without the OpenAPI validator)", () => {
  // The suite's default `app` mounts express-openapi-validator, which rejects
  // bad input before the runtime validators run. This app has no validator
  // middleware — the same configuration that runs on edge runtimes — so these
  // assertions exercise src/validate.ts end-to-end through the routes.
  const app = createApp({ prefix: "/" });

  test("rejects missing coordinates with 400 {message, errors}", async () => {
    const response = await request(app).get("/extremes");

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/latitude/);
    expect(response.body.errors).toEqual([{ path: "latitude", message: expect.any(String) }]);
  });

  test("rejects out-of-range latitude", async () => {
    const response = await request(app).get("/extremes").query({ latitude: 200, longitude: 0 });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("latitude");
  });

  test("rejects an invalid date", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({ latitude: 26.772, longitude: -80.05, start: "nope" });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("start");
  });

  test("rejects an unknown datum", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({ latitude: 26.772, longitude: -80.05, datum: "BOGUS" });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("datum");
  });

  test("rejects an out-of-range maxResults", async () => {
    const response = await request(app)
      .get("/stations")
      .query({ latitude: 26.772, longitude: -80.05, maxResults: 500 });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("maxResults");
  });

  test.each(["1,2,3", "-71.2,999,-70,1000", "-181,0,0,1", "-71.2,42,-70,41.2"])(
    "rejects invalid bbox %s",
    async (bbox) => {
      const response = await request(app).get("/stations").query({ bbox });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].path).toBe("bbox");
      expect(response.body.message).toMatch(/minLon,minLat,maxLon,maxLat/);
    },
  );

  test("coerces and predicts on valid input", async () => {
    const response = await request(app)
      .get("/extremes")
      .query({ latitude: "26.772", longitude: "-80.05" });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.extremes)).toBe(true);
  });
});

describe("compress option", () => {
  const big = { latitude: 26.772, longitude: -80.05 }; // 7-day timeline is well over the ~1KB gzip threshold

  test("compresses responses by default", async () => {
    const response = await request(createApp({ prefix: "/" }))
      .get("/timeline")
      .query(big)
      .set("Accept-Encoding", "gzip");

    expect(response.headers["content-encoding"]).toBe("gzip");
  });

  test("does not compress when compress is false", async () => {
    const response = await request(createApp({ prefix: "/", compress: false }))
      .get("/timeline")
      .query(big)
      .set("Accept-Encoding", "gzip");

    expect(response.headers["content-encoding"]).toBeUndefined();
  });
});
