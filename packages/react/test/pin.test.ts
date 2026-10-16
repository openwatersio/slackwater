import { describe, test, expect } from "vitest";
import {
  boxContains,
  boxCovers,
  boxFromBounds,
  currentPinState,
  gaugeBucket,
  listingBbox,
  padBox,
  pinRank,
  pinScale,
  pinScaleExpression,
  stationKey,
  tidePinState,
  visibleStations,
  type MapStation,
} from "../src/utils/pin.js";
import { pinRampColor } from "../src/utils/color.js";
import { pinImageId } from "../src/utils/pin-images.js";
import type { Extreme } from "../src/types.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 15, 12);

const extreme = (hours: number, level: number, high: boolean): Extreme => ({
  time: new Date(T0 + hours * HOUR),
  level,
  high,
  low: !high,
  label: high ? "High" : "Low",
});

/** Water from a 1 ft low at T0 to a 9 ft high six hours later, sampled hourly. */
const tideTimeline = Array.from({ length: 7 }, (_, h) => ({
  time: new Date(T0 + h * HOUR),
  level: 1 + (8 * h) / 6,
}));
const tideExtremes = [extreme(-6, 9, true), extreme(0, 1, false), extreme(6, 9, true)];

describe("gaugeBucket", () => {
  test("fills to where the height sits between the turns, in eight steps", () => {
    expect(gaugeBucket(1, 1, 9)).toBe(0);
    expect(gaugeBucket(5, 1, 9)).toBe(4);
    expect(gaugeBucket(9, 9, 1)).toBe(8);
    expect(gaugeBucket(2.6, 1, 9)).toBe(2);
  });

  test("clamps a height past either turn", () => {
    expect(gaugeBucket(10, 1, 9)).toBe(8);
    expect(gaugeBucket(0, 1, 9)).toBe(0);
  });

  test("has no fill when the turns are level", () => {
    expect(gaugeBucket(1, 1, 1.005)).toBeUndefined();
  });
});

describe("tidePinState", () => {
  test("is a rising gauge with its reading toward a high", () => {
    const state = tidePinState(tideTimeline, tideExtremes, "feet", T0 + 3 * HOUR, true, "en-US");
    expect(state).toEqual({ shape: "gauge", tone: "rising", bucket: 4, reading: "5.0 ft" });
  });

  test("falls toward a low", () => {
    const extremes = [extreme(-6, 1, false), extreme(0, 9, true), extreme(6, 1, false)];
    const timeline = tideTimeline.map((p) => ({ ...p, level: 10 - p.level }));
    const state = tidePinState(timeline, extremes, "meters", T0 + 3 * HOUR, true, "en-US");
    expect(state).toEqual({ shape: "gauge", tone: "falling", bucket: 4, reading: "5.00 m" });
  });

  test("is a dot in the trend's color below the reading zoom", () => {
    expect(tidePinState(tideTimeline, tideExtremes, "feet", T0 + 3 * HOUR, false)).toEqual({
      shape: "dot",
      tone: "rising",
    });
  });

  test("keeps its reading as a dot when the last turn isn't loaded", () => {
    const state = tidePinState(tideTimeline, [extreme(6, 9, true)], "feet", T0 + HOUR, true);
    expect(state).toMatchObject({ shape: "dot", tone: "rising", reading: expect.any(String) });
  });

  test("is unknown without a next turn", () => {
    expect(tidePinState(tideTimeline, tideExtremes.slice(0, 2), "feet", T0 + HOUR, true)).toEqual({
      shape: "dot",
      tone: "unknown",
    });
  });
});

describe("currentPinState", () => {
  const timeline = [
    { time: new Date(T0), speed: -0.4 },
    { time: new Date(T0 + HOUR), speed: 0.5 },
    { time: new Date(T0 + 2 * HOUR), speed: 3 },
  ];
  const sets = { flood: 45, ebb: 225 };

  test("is green at the slack threshold, pointing its set", () => {
    expect(currentPinState(timeline, sets, 0.5, T0 + HOUR, true, "en-US")).toEqual({
      shape: "arrow",
      tone: "slack",
      bearing: 45,
      reading: "0.5 kn",
    });
  });

  test("takes the ramp lifted toward white above the threshold", () => {
    const state = currentPinState(timeline, sets, 0.5, T0 + 2 * HOUR, true);
    // #f5c96b, the ramp at 3 kn, moved 30% of the way to white.
    expect(state.tone).toBe("#f8d997");
    expect(pinRampColor(12)).toBe("#d97570");
  });

  test("points the ebb set on an ebb", () => {
    expect(currentPinState(timeline, sets, 0.3, T0, true, "en-US")).toEqual({
      shape: "arrow",
      tone: pinRampColor(0.4),
      bearing: 225,
      reading: "0.4 kn",
    });
  });

  test("is a dot in its speed's color, with no reading, below the reading zoom", () => {
    expect(currentPinState(timeline, sets, 0.3, T0, false)).toEqual({
      shape: "dot",
      tone: pinRampColor(0.4),
    });
  });

  test("is a dot when the station publishes no set for that direction", () => {
    const state = currentPinState(timeline, { flood: 45 }, 0.5, T0, true);
    expect(state.shape).toBe("dot");
    expect(state.bearing).toBeUndefined();
    expect(state.reading).toBeDefined();
  });

  test("is unknown outside its timeline", () => {
    expect(currentPinState(timeline, sets, 0.5, T0 - HOUR, true).tone).toBe("unknown");
  });
});

describe("pinImageId", () => {
  test("names a gauge by fill, trend, and color", () => {
    expect(pinImageId({ shape: "gauge", tone: "falling", bucket: 3 }, "#fbbf24")).toBe(
      "sw-pin|gauge|3|down|#fbbf24",
    );
    expect(pinImageId({ shape: "arrow", tone: "slack" }, "#88b868")).toBe("sw-pin|arrow|#88b868");
  });
});

describe("pinScale", () => {
  test("runs from 0.4× at zoom 6 to 1.8× at 12.5, holding small through the label band", () => {
    expect(pinScale(6)).toBeCloseTo(0.4);
    expect(pinScale(9.5)).toBeCloseTo(0.648, 3);
    expect(pinScale(10.5)).toBeCloseTo(0.854, 3);
    expect(pinScale(12.5)).toBeCloseTo(1.8);
  });

  test("clamps beyond either end", () => {
    expect(pinScale(2)).toBeCloseTo(0.4);
    expect(pinScale(16)).toBeCloseTo(1.8);
  });

  test("is the style expression MapLibre evaluates", () => {
    expect(pinScaleExpression(17)).toEqual([
      "interpolate",
      ["exponential", 1.7],
      ["zoom"],
      6,
      17 * 0.4,
      12.5,
      17 * 1.8,
    ]);
  });
});

const station = (
  id: string,
  longitude: number,
  latitude: number,
  extra: Partial<MapStation> = {},
): MapStation => ({
  id,
  name: id,
  latitude,
  longitude,
  country: "US",
  continent: "Americas",
  timezone: "UTC",
  type: "reference",
  kind: "tide",
  ...extra,
});

describe("pinRank", () => {
  test("puts harmonic before subordinate, and unservable last", () => {
    expect(pinRank(station("a", 0, 0))).toBeLessThan(
      pinRank(station("b", 0, 0, { type: "subordinate" })),
    );
    expect(pinRank(station("b", 0, 0, { type: "subordinate" }))).toBeLessThan(
      pinRank(station("c", 0, 0, { kind: "current", predictions: false })),
    );
  });
});

describe("visibleStations", () => {
  // At zoom 10 a 44 px cell is about 0.0302° of longitude.
  const box = { south: 47, west: -123, north: 48, east: -122 };
  const keys = (list: MapStation[]) => list.map(stationKey).sort();

  test("keeps the harmonic station in a shared cell, whatever order it arrives in", () => {
    const sub = station("sub", -122.501, 47.5001, { type: "subordinate" });
    const ref = station("ref", -122.5005, 47.5002, { kind: "current" });
    expect(keys(visibleStations([sub, ref], box, 10))).toEqual(["current:ref"]);
    expect(keys(visibleStations([ref, sub], box, 10))).toEqual(["current:ref"]);
  });

  test("breaks a tie by id, so the same station wins every time", () => {
    const a = station("a", -122.501, 47.5001);
    const b = station("b", -122.5005, 47.5002);
    expect(keys(visibleStations([b, a], box, 10))).toEqual(["tide:a"]);
  });

  test("keeps one station per 44 px cell and drops those outside the box", () => {
    // a and a2 sit 38 px apart in one cell; b is 47 px east of a, in the next.
    const list = [
      station("a2", -122.5093, 47.5),
      station("a", -122.4831, 47.5),
      station("b", -122.4509, 47.5),
      station("out", -121.5, 47.5),
    ];
    expect(keys(visibleStations(list, box, 10))).toEqual(["tide:a", "tide:b"]);
  });

  test("shares cells that a closer zoom separates", () => {
    const list = [station("a", -122.501, 47.5001), station("b", -122.5005, 47.5002)];
    expect(visibleStations(list, box, 7)).toHaveLength(1);
    expect(visibleStations(list, box, 16)).toHaveLength(2);
  });

  test("always keeps a pinned station", () => {
    const sub = station("sub", -122.501, 47.5001, { type: "subordinate" });
    const ref = station("ref", -122.5005, 47.5002);
    expect(keys(visibleStations([sub, ref], box, 10, ["tide:sub"]))).toEqual([
      "tide:ref",
      "tide:sub",
    ]);
    expect(visibleStations([ref], box, 10, ["tide:ref"])).toEqual([ref]);
  });

  test("shows a station that can't be served only from the name zoom", () => {
    const list = [station("x", -122.5, 47.5, { kind: "current", predictions: false })];
    expect(visibleStations(list, box, 10)).toEqual([]);
    expect(visibleStations(list, box, 10.5)).toHaveLength(1);
  });
});

describe("camera boxes", () => {
  test("wraps longitudes past the antimeridian", () => {
    expect(boxFromBounds(175, 50, 190, 60)).toEqual({
      south: 50,
      west: 175,
      north: 60,
      east: -170,
    });
    expect(boxFromBounds(-200, -10, 200, 10)).toEqual({
      south: -10,
      west: -180,
      north: 10,
      east: 180,
    });
  });

  test("contains points across the antimeridian", () => {
    const box = { south: 50, west: 175, north: 60, east: -170 };
    expect(boxContains(box, 55, 179)).toBe(true);
    expect(boxContains(box, 55, -175)).toBe(true);
    expect(boxContains(box, 55, 0)).toBe(false);
    expect(boxContains(box, 61, 179)).toBe(false);
  });

  test("pads by a fraction of its span and covers a small pan", () => {
    const view = { south: 47, west: -123, north: 48, east: -122 };
    const padded = padBox(view, 0.5);
    expect(padded).toEqual({ south: 46.5, west: -123.5, north: 48.5, east: -121.5 });
    expect(boxCovers(padded, { south: 47.2, west: -122.8, north: 48.2, east: -121.8 })).toBe(true);
    expect(boxCovers(padded, { south: 47, west: -122, north: 48, east: -121 })).toBe(false);
  });

  test("compares longitudes as arcs, not endpoints", () => {
    const outer = { south: -10, west: -170, north: 10, east: 170 };
    expect(boxCovers(outer, { south: 0, west: 100, north: 1, east: -100 })).toBe(false);
  });

  test("asks for the whole latitude band when the box wraps", () => {
    expect(listingBbox({ south: 47, west: -123, north: 48, east: -122 })).toBe("-123,47,-122,48");
    expect(listingBbox({ south: 50, west: 175, north: 60, east: -170 })).toBe("-180,50,180,60");
  });
});
