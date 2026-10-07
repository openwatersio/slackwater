import { describe, test, expect } from "vitest";
import * as validate from "../src/validate.js";

// Unit tests for the runtime validators. These are what actually run in
// production and on edge runtimes (where express-openapi-validator can't); the
// endpoint suite mounts the OpenAPI validator in front, so it shadows these on
// the rejection paths. Test them directly here.

describe("validate.number", () => {
  test("coerces numeric strings", () => {
    expect(validate.number({ latitude: "26.772" }, "latitude")).toBe(26.772);
  });

  test("returns the default when absent or empty", () => {
    expect(validate.number({}, "maxResults", { default: 10 })).toBe(10);
    expect(validate.number({ maxResults: "" }, "maxResults", { default: 10 })).toBe(10);
  });

  test("returns undefined when absent and no default", () => {
    expect(validate.number({}, "maxDistance")).toBeUndefined();
  });

  test("throws when required and absent", () => {
    expect(() => validate.number({}, "latitude", { required: true })).toThrow(
      validate.ValidationError,
    );
  });

  test("throws for non-numeric input", () => {
    expect(() => validate.number({ latitude: "abc" }, "latitude")).toThrow(/must be a number/);
  });

  test("enforces min and max", () => {
    expect(() => validate.number({ latitude: "91" }, "latitude", { max: 90 })).toThrow(/<= 90/);
    expect(() => validate.number({ latitude: "-91" }, "latitude", { min: -90 })).toThrow(/>= -90/);
  });

  test("enforces integer", () => {
    expect(() => validate.number({ maxResults: "1.5" }, "maxResults", { integer: true })).toThrow(
      /must be an integer/,
    );
  });
});

describe("validate.date", () => {
  test("parses ISO 8601", () => {
    const d = validate.date({ start: "2026-07-11T00:00:00Z" }, "start", () => new Date(0));
    expect(d.toISOString()).toBe("2026-07-11T00:00:00.000Z");
  });

  test("uses the fallback when absent", () => {
    const fallback = new Date("2020-01-01T00:00:00Z");
    expect(validate.date({}, "start", () => fallback)).toBe(fallback);
  });

  test("throws for an invalid date", () => {
    expect(() => validate.date({ start: "not-a-date" }, "start", () => new Date())).toThrow(
      /ISO 8601/,
    );
  });
});

describe("validate.datum", () => {
  test("accepts a valid datum", () => {
    expect(validate.datum({ datum: "MLLW" })).toBe("MLLW");
  });

  test("returns undefined when absent", () => {
    expect(validate.datum({})).toBeUndefined();
  });

  test("throws for an unknown datum", () => {
    expect(() => validate.datum({ datum: "BOGUS" })).toThrow(validate.ValidationError);
  });
});

describe("validate.units", () => {
  test("defaults to meters", () => {
    expect(validate.units({})).toBe("meters");
  });

  test("accepts feet", () => {
    expect(validate.units({ units: "feet" })).toBe("feet");
  });

  test("throws for an unknown unit", () => {
    expect(() => validate.units({ units: "furlongs" })).toThrow(/meters/);
  });
});

describe("validate.bbox", () => {
  test("parses four comma-separated numbers", () => {
    expect(validate.bbox({ bbox: "-80.1,26.7,-80.0,26.8" })).toEqual([-80.1, 26.7, -80.0, 26.8]);
  });

  test("returns undefined when absent", () => {
    expect(validate.bbox({})).toBeUndefined();
  });

  test("throws for the wrong number of values", () => {
    expect(() => validate.bbox({ bbox: "-80.1,26.7,-80.0" })).toThrow(validate.ValidationError);
  });

  test("throws for non-numeric values", () => {
    expect(() => validate.bbox({ bbox: "a,b,c,d" })).toThrow(validate.ValidationError);
  });

  test.each([
    "-181,0,0,1",
    "181,0,0,1",
    "0,0,-181,1",
    "0,0,181,1",
    "0,-91,1,0",
    "0,91,1,90",
    "0,-90,1,-91",
    "0,0,1,91",
    "-71.2,999,-70,1000",
    "-71.2,42,-70,41.2",
  ])("rejects impossible bbox %s with its expected axis order", (bbox) => {
    expect(() => validate.bbox({ bbox })).toThrow(/minLon,minLat,maxLon,maxLat/);
  });

  test.each([
    [-180, -90, 180, 90],
    [170, -20, -170, 20],
    [0, 0, 0, 0],
    [41.2, -71.2, 42, -70],
  ])("preserves valid coordinates %j,%j,%j,%j", (...coordinates) => {
    expect(validate.bbox({ bbox: coordinates.join(",") })).toEqual(coordinates);
  });
});

describe("ValidationError", () => {
  test("carries a 400 status and structured errors", () => {
    const error = new validate.ValidationError([
      { path: "latitude", message: "latitude is required" },
    ]);
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ path: "latitude", message: "latitude is required" }]);
    expect(error.message).toBe("latitude is required");
  });
});
