import { describe, test, expect } from "vitest";
import {
  getCurrentEventsPrediction,
  getCurrentTimelinePrediction,
  nearestCurrentStation,
  currentStationsNear,
  findCurrentStation,
  currentStationUnavailable,
  parseCurrentBin,
  slackWindows,
} from "../src/index.js";
import { stationsById } from "@slackwater/database";

// Deception Pass (Narrows), noaa/PUG1701.
const position = { lat: 48.406, lon: -122.643 };
const span = {
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-06-02T00:00:00Z"),
};

// Active Pass, chs-active-pass: a CHS station whose predictions can't be served.
const activePass = { lat: 48.8604, lon: -123.3128 };

function positionOf(id: string) {
  const station = stationsById.get(id)!;
  return { lat: station.latitude, lon: station.longitude };
}

const CHS = "Canadian Hydrographic Service";

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

  test("skips a CHS station near the position", () => {
    const prediction = getCurrentEventsPrediction({ ...activePass, ...span });
    expect(prediction.station.source.name).not.toBe(CHS);
    expect(prediction.events.length).toBeGreaterThan(0);
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

  test("skips stations that can't be predicted", () => {
    expect(nearestCurrentStation(activePass).source.name).not.toBe(CHS);
    expect(nearestCurrentStation(positionOf("noaa-boundary-pass")).id).not.toBe(
      "noaa-boundary-pass",
    );
  });

  test("never resolves to a secondary bin", () => {
    // noaa/ACT8851 and noaa/ACT8851@2 share a position.
    expect(nearestCurrentStation(positionOf("noaa/ACT8851@2")).id).toBe("noaa/ACT8851");
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

  test("skips stations that can't be predicted and secondary bins", () => {
    const stations = currentStationsNear({ ...activePass, maxResults: 20 });
    expect(stations.length).toBe(20);
    expect(stations.some((s) => s.source.name === CHS)).toBe(false);

    const boundary = currentStationsNear({ ...positionOf("noaa-boundary-pass"), maxResults: 5 });
    expect(boundary.some((s) => s.id === "noaa-boundary-pass")).toBe(false);

    const ids = currentStationsNear({ ...positionOf("noaa/ACT8851"), maxResults: 5 }).map(
      (s) => s.id,
    );
    expect(ids).toContain("noaa/ACT8851");
    expect(ids.some((id) => id.includes("@"))).toBe(false);
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

  test("finds a secondary bin by its id", () => {
    const station = findCurrentStation("noaa/ACT8851@2");
    expect(station.id).toBe("noaa/ACT8851@2");
    expect(station.getEventsPrediction(span).events.length).toBeGreaterThan(0);
  });

  test("finds a CHS station but refuses to predict it", () => {
    const station = findCurrentStation("chs-active-pass");
    expect(station.name).toMatch(/Active Pass/);
    expect(() => station.getEventsPrediction(span)).toThrow(
      /Canadian Hydrographic Service.*tides\.gc\.ca/,
    );
    expect(() => station.getTimelinePrediction(span)).toThrow(/Canadian Hydrographic Service/);
  });

  test("refuses to predict a station with nothing to predict from", () => {
    const station = findCurrentStation("noaa-boundary-pass");
    expect(() => station.getEventsPrediction(span)).toThrow(
      /no harmonic constituents or subordinate offsets/,
    );
  });

  test("leaves out a direction the station doesn't publish", () => {
    // noaa/ACT3681 publishes a flood direction but no ebb direction.
    const { events } = findCurrentStation("noaa/ACT3681").getEventsPrediction(span);
    expect(events.some((e) => e.kind === "maxEbb")).toBe(true);
    for (const event of events) {
      if (event.kind === "maxFlood") expect(event.direction).toBe(10);
      else expect(event).not.toHaveProperty("direction");
    }
  });

  test("tide station ids are not current stations", () => {
    expect(() => findCurrentStation("noaa/8722588")).toThrow(/not found/);
  });
});

describe("currentStationUnavailable", () => {
  test("is undefined for a station that can be predicted", () => {
    expect(currentStationUnavailable(stationsById.get("noaa/PUG1701")!)).toBeUndefined();
    expect(currentStationUnavailable(stationsById.get("noaa/PCT0236")!)).toBeUndefined();
  });

  test("refuses CHS stations for redistribution", () => {
    const refusal = currentStationUnavailable(stationsById.get("chs-active-pass")!);
    expect(refusal?.reason).toBe("redistribution");
    expect(refusal?.message).toMatch(/Canadian Hydrographic Service/);
  });

  test("refuses stations with nothing to predict from", () => {
    const refusal = currentStationUnavailable(stationsById.get("noaa-boundary-pass")!);
    expect(refusal?.reason).toBe("no-model");
  });

  test.each(["test/missing", "chs-active-pass"])(
    "refuses a subordinate whose reference %s has no constituents",
    (reference) => {
      const subordinate = {
        name: "Test Subordinate",
        source: { name: "US National Oceanic and Atmospheric Administration" },
        harmonic_constituents: [],
        current: { offsets: { reference } },
      } as unknown as Parameters<typeof currentStationUnavailable>[0];
      const refusal = currentStationUnavailable(subordinate);
      expect(refusal?.reason).toBe("no-model");
      expect(refusal?.message).toContain(`subordinate to ${reference}`);
    },
  );
});

describe("parseCurrentBin", () => {
  test("splits a secondary bin id", () => {
    expect(parseCurrentBin("noaa/EPT0003@11")).toEqual({ base: "noaa/EPT0003", bin: 11 });
    expect(parseCurrentBin("noaa/EPT0003@0")).toEqual({ base: "noaa/EPT0003", bin: 0 });
  });

  test("treats a bare id as the primary bin", () => {
    expect(parseCurrentBin("noaa/EPT0003")).toEqual({ base: "noaa/EPT0003" });
    expect(parseCurrentBin("noaa/EPT0003@01")).toEqual({ base: "noaa/EPT0003@01" });
  });
});
