import { describe, test, expect } from "vitest";
import {
  getCurrentEventsPrediction,
  getCurrentTimelinePrediction,
  nearestCurrentStation,
  currentStationsNear,
  findCurrentStation,
  slackWindows,
} from "../src/index.js";

// Deception Pass (Narrows), noaa/PUG1701.
const position = { lat: 48.406, lon: -122.643 };
const span = {
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-06-02T00:00:00Z"),
};

describe("getCurrentEventsPrediction", () => {
  test("gets events from the nearest current station", () => {
    const prediction = getCurrentEventsPrediction({ ...position, ...span });

    expect(prediction.station.id).toBe("noaa/PUG1701");
    expect(prediction.events.length).toBeGreaterThan(0);
    expect(prediction.events.some((e) => e.kind === "maxFlood")).toBe(true);
    expect(prediction.events.some((e) => e.kind === "maxEbb")).toBe(true);
    expect(prediction.events.some((e) => e.kind === "slack")).toBe(true);
    for (const event of prediction.events) {
      if (event.kind === "maxFlood") expect(event.speed).toBeGreaterThan(0);
      if (event.kind === "maxEbb") expect(event.speed).toBeLessThan(0);
    }
  });
});

describe("getCurrentTimelinePrediction", () => {
  test("gets a signed speed timeline from the nearest current station", () => {
    const prediction = getCurrentTimelinePrediction({ ...position, ...span });

    expect(prediction.station.id).toBe("noaa/PUG1701");
    expect(prediction.timeline.length).toBe(145); // every 10 minutes for 24 h
    expect(Math.min(...prediction.timeline.map((p) => p.speed))).toBeLessThan(0);
    expect(Math.max(...prediction.timeline.map((p) => p.speed))).toBeGreaterThan(0);

    // The timeline feeds slackWindows directly.
    const windows = slackWindows(prediction.timeline, 1.5);
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.end.getTime()).toBeGreaterThan(window.start.getTime());
    }
  });
});

describe("nearestCurrentStation", () => {
  test("finds the nearest current station", () => {
    const station = nearestCurrentStation(position);
    expect(station.id).toBe("noaa/PUG1701");
    expect(station.kind).toBe("current");
    expect(station.distance).toBeLessThan(1);
  });

  test("throws when no current station is in range", () => {
    expect(() => nearestCurrentStation({ lat: 0, lon: 0, maxDistance: 1 })).toThrow(
      /No current stations found/,
    );
  });
});

describe("currentStationsNear", () => {
  test("finds current stations near a position", () => {
    const stations = currentStationsNear({ ...position, maxResults: 3 });
    expect(stations.length).toBe(3);
    expect(stations[0].id).toBe("noaa/PUG1701");
    expect(stations.every((s) => s.kind === "current")).toBe(true);
  });

  test("applies a caller filter on top of the kind filter", () => {
    const stations = currentStationsNear({
      ...position,
      maxResults: 3,
      filter: (station) => station.id !== "noaa/PUG1701",
    });
    expect(stations.length).toBe(3);
    expect(stations.every((s) => s.id !== "noaa/PUG1701")).toBe(true);
  });
});

describe("findCurrentStation", () => {
  test("finds a current station by id or source id", () => {
    expect(findCurrentStation("noaa/PUG1701").name).toBe("Deception Pass (Narrows)");
    expect(findCurrentStation("PUG1701").id).toBe("noaa/PUG1701");
  });

  test("resolves a subordinate's reference station", () => {
    const station = findCurrentStation("PCT0236");
    const { events } = station.getEventsPrediction(span);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "maxFlood")).toBe(true);
  });

  test("throws for an unknown station", () => {
    expect(() => findCurrentStation("nope")).toThrow("Current station not found: nope");
  });

  test("tide station ids are not current stations", () => {
    expect(() => findCurrentStation("noaa/8722588")).toThrow(/not found/);
  });
});
