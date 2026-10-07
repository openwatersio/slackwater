import {
  getExtremesPrediction,
  nearestStation,
  findStation,
  getTimelinePrediction,
  getWaterLevelAtTime,
  stationsNear,
} from "../src/index.js";
import { describe, test, expect } from "vitest";
import { stations as dbStations } from "@slackwater/database";

describe("getExtremesPrediction", () => {
  const options = {
    lat: 26.772,
    lon: -80.05,
    start: new Date("2025-12-18T00:00:00-05:00"),
    end: new Date("2025-12-19T00:00:00-05:00"),
    datum: "MLLW",
  };

  test("gets extremes from nearest station", () => {
    const prediction = getExtremesPrediction(options);

    expect(prediction.station.id).toEqual("noaa/8722588");
    expect(prediction.datum).toBe("MLLW");

    const { extremes } = prediction;
    expect(extremes.length).toBe(4);
    expect(extremes[0].time).toEqual(new Date("2025-12-18T05:28:19.418Z"));
    expect(extremes[0].level).toBeCloseTo(0.02, 2);
    expect(extremes[0].high).toBe(false);
    expect(extremes[0].low).toBe(true);
    expect(extremes[0].label).toBe("Low");
    expect(prediction.units).toBe("meters");
  });

  test("with units=feet", () => {
    const prediction = getExtremesPrediction({ ...options, units: "feet" });
    expect(prediction.units).toBe("feet");
    expect(prediction.extremes[0].level).toBeCloseTo(0.07, 2);
    expect(prediction.extremes[1].level).toBeCloseTo(2.99, 2);
  });
});

describe("getTimelinePrediction", () => {
  test("gets timeline from nearest station", () => {
    const prediction = getTimelinePrediction({
      lat: 26.772,
      lon: -80.05,
      start: new Date("2025-12-19T00:00:00-05:00"),
      end: new Date("2025-12-19T01:00:00-05:00"),
    });

    expect(prediction.station.id).toEqual("noaa/8722588");
    expect(prediction.datum).toBe("MLLW");
    expect(prediction.units).toBe("meters");
    expect(prediction.timeline.length).toBe(7); // Every 10 minutes for 1 hour = 7 points
  });

  test("with units=feet", () => {
    const prediction = getTimelinePrediction({
      lat: 26.772,
      lon: -80.05,
      start: new Date("2025-12-19T00:00:00-05:00"),
      end: new Date("2025-12-19T01:00:00-05:00"),
      units: "feet",
    });
    expect(prediction.units).toBe("feet");
    expect(prediction.timeline[0].level).toBeCloseTo(0.24, 2);
  });
});

describe("getWaterLevelAtTime", () => {
  test("gets water level at specific time from nearest station", () => {
    const prediction = getWaterLevelAtTime({
      lat: 26.772,
      lon: -80.05,
      time: new Date("2025-12-19T00:30:00-05:00"),
      datum: "MSL",
    });

    expect(prediction.station.id).toEqual("noaa/8722588");
    expect(prediction.datum).toBe("MSL");
    expect(prediction.time).toEqual(new Date("2025-12-19T05:30:00.000Z"));
    expect(typeof prediction.level).toBe("number");
  });

  test("with units=feet", () => {
    const prediction = getWaterLevelAtTime({
      lat: 26.772,
      lon: -80.05,
      time: new Date("2025-12-19T00:30:00-05:00"),
      datum: "MSL",
      units: "feet",
    });
    expect(prediction.units).toBe("feet");
    expect(prediction.level).toBeCloseTo(-1.43, 2);
  });

  test("with unknown units", () => {
    expect(() =>
      getWaterLevelAtTime({
        lat: 26.772,
        lon: -80.05,
        time: new Date("2025-12-19T00:30:00-05:00"),
        // @ts-expect-error Testing unknown units
        units: "fathoms",
      }),
    ).toThrow("Unsupported units: fathoms");
  });
});

describe("for a specific station", () => {
  const station = nearestStation({ lat: 45.6, lon: -122.7 });

  describe("getExtremesPrediction", () => {
    test("can return extremes from station", () => {
      const station = nearestStation({ lat: 26.772, lon: -80.05 });

      const start = new Date("2025-12-17T00:00:00-05:00");
      const end = new Date("2025-12-18T05:00:00-05:00");

      const { extremes: predictions } = station.getExtremesPrediction({
        start,
        end,
        datum: "MLLW",
      });

      expect(predictions.length).toBe(4);
      expect(predictions[0].time).toEqual(new Date("2025-12-17T11:22:51.191Z"));
      expect(predictions[0].level).toBeCloseTo(0.9, 1);
      expect(predictions[0].high).toBe(true);
      expect(predictions[0].low).toBe(false);
      expect(predictions[0].label).toBe("High");
    });
  });

  describe("getTimelinePrediction", () => {
    test("gets timeline", () => {
      const prediction = station.getTimelinePrediction({
        start: new Date("2025-12-19T00:00:00Z"),
        end: new Date("2025-12-19T01:00:00Z"),
      });
      // Every 10 minutes for 1 hour = 7 points
      expect(prediction.timeline.length).toBe(7);
      expect(prediction.datum).toBe("MLLW");
    });
  });

  describe("getWaterLevelAtTime", () => {
    test("gets water level at specific time", () => {
      const prediction = station.getWaterLevelAtTime({
        time: new Date("2025-12-19T00:30:00Z"),
      });
      expect(prediction.time).toEqual(new Date("2025-12-19T00:30:00Z"));
      expect(prediction.datum).toBe("MLLW");
      expect(typeof prediction.level).toBe("number");
    });
  });
});

describe("nearestStation", () => {
  [
    { lat: 26.772, lon: -80.052 },
    { lat: 26.772, lng: -80.052 },
    { latitude: 26.772, longitude: -80.052 },
  ].forEach((position) => {
    test(`finds station with ${Object.keys(position).join("/")}`, () => {
      const station = nearestStation(position);
      expect(station.source.id).toBe("8722588");
    });
  });

  test("raises error when no stations found", () => {
    expect(() => nearestStation({ lat: 0, lon: 0, maxDistance: 1 })).toThrow(
      'No stations found with options: {"lat":0,"lon":0,"maxDistance":1}',
    );
  });
});

describe("stationsNear", () => {
  test("finds nearby stations", () => {
    const nearby = stationsNear({ lat: 26.772, lon: -80.05, maxResults: 3 });
    expect(nearby.length).toBe(3);
  });
});

describe("excludes current stations", () => {
  // The database also carries current stations, which the tide predictor
  // can't use; every lookup must filter them out before useStation.
  const currentIds = new Set(dbStations.filter((s) => s.kind === "current").map((s) => s.id));
  const current = dbStations.find((s) => s.kind === "current")!;

  test("nearestStation at a current station's own position", () => {
    const station = nearestStation({ lat: current.latitude, lon: current.longitude });
    expect(currentIds.has(station.id)).toBe(false);
  });

  test("stationsNear around a current station", () => {
    const nearby = stationsNear({
      lat: current.latitude,
      lon: current.longitude,
      maxResults: 5,
    });
    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby.some((station) => currentIds.has(station.id))).toBe(false);
  });

  test("findStation refuses a current station's id", () => {
    expect(() => findStation(current.id)).toThrow(`Station not found: ${current.id}`);
  });
});

describe("findStation", () => {
  test("raises error for unknown station", () => {
    expect(() => findStation("unknown")).toThrow("Station not found: unknown");
  });

  test("finds station by id", () => {
    const station = findStation("noaa/8443970");
    expect(station).toBeDefined();
    expect(station.source.id).toBe("8443970");
    expect(station.getExtremesPrediction).toBeDefined();
  });

  test("finds station by source id", () => {
    const station = findStation("8443970");
    expect(station).toBeDefined();
    expect(station.id).toBe("noaa/8443970");
    expect(station.getExtremesPrediction).toBeDefined();
  });
});
