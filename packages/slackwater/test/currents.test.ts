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
import { loadStations } from "@slackwater/database";

const { byId } = await loadStations();

// Deception Pass (Narrows), noaa/PUG1701.
const position = { lat: 48.406, lon: -122.643 };
const span = {
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-06-02T00:00:00Z"),
};

// Active Pass, chs-active-pass: a CHS station whose predictions can't be served.
const activePass = { lat: 48.8604, lon: -123.3128 };

function positionOf(id: string) {
  const station = byId(id)!;
  return { lat: station.latitude, lon: station.longitude };
}

const CHS = "Canadian Hydrographic Service";

describe("getCurrentEventsPrediction", () => {
  test("gets events from the nearest current station", async () => {
    const prediction = await getCurrentEventsPrediction({ ...position, ...span });

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

  test("skips a CHS station near the position", async () => {
    const prediction = await getCurrentEventsPrediction({ ...activePass, ...span });
    expect(prediction.station.source.name).not.toBe(CHS);
    expect(prediction.events.length).toBeGreaterThan(0);
  });
});

describe("getCurrentTimelinePrediction", () => {
  test("gets a signed speed timeline from the nearest current station", async () => {
    const prediction = await getCurrentTimelinePrediction({ ...position, ...span });

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
  test("finds the nearest current station", async () => {
    const station = await nearestCurrentStation(position);
    expect(station.id).toBe("noaa/PUG1701");
    expect(station.kind).toBe("current");
    expect(station.distance).toBeLessThan(1);
  });

  test("skips stations that can't be predicted", async () => {
    expect((await nearestCurrentStation(activePass)).source.name).not.toBe(CHS);
    expect((await nearestCurrentStation(positionOf("noaa-boundary-pass"))).id).not.toBe(
      "noaa-boundary-pass",
    );
  });

  test("never resolves to a secondary bin", async () => {
    // noaa/ACT8851 and noaa/ACT8851@2 share a position.
    expect((await nearestCurrentStation(positionOf("noaa/ACT8851@2"))).id).toBe("noaa/ACT8851");
  });

  test("throws when no current station is in range", async () => {
    await expect(nearestCurrentStation({ lat: 0, lon: 0, maxDistance: 1 })).rejects.toThrow(
      /No current stations found/,
    );
  });
});

describe("currentStationsNear", () => {
  test("finds current stations near a position", async () => {
    const stations = await currentStationsNear({ ...position, maxResults: 3 });
    expect(stations.length).toBe(3);
    expect(stations[0].id).toBe("noaa/PUG1701");
    expect(stations.every((s) => s.kind === "current")).toBe(true);
  });

  test("applies a caller filter on top of the kind filter", async () => {
    const stations = await currentStationsNear({
      ...position,
      maxResults: 3,
      filter: (station) => station.id !== "noaa/PUG1701",
    });
    expect(stations.length).toBe(3);
    expect(stations.every((s) => s.id !== "noaa/PUG1701")).toBe(true);
  });

  test("skips stations that can't be predicted and secondary bins", async () => {
    const stations = await currentStationsNear({ ...activePass, maxResults: 20 });
    expect(stations.length).toBe(20);
    expect(stations.some((s) => s.source.name === CHS)).toBe(false);

    const boundary = await currentStationsNear({
      ...positionOf("noaa-boundary-pass"),
      maxResults: 5,
    });
    expect(boundary.some((s) => s.id === "noaa-boundary-pass")).toBe(false);

    const ids = (await currentStationsNear({ ...positionOf("noaa/ACT8851"), maxResults: 5 })).map(
      (s) => s.id,
    );
    expect(ids).toContain("noaa/ACT8851");
    expect(ids.some((id) => id.includes("@"))).toBe(false);
  });
});

describe("findCurrentStation", () => {
  test("finds a current station by id or source id", async () => {
    expect((await findCurrentStation("noaa/PUG1701")).name).toBe("Deception Pass (Narrows)");
    expect((await findCurrentStation("PUG1701")).id).toBe("noaa/PUG1701");
  });

  test("resolves a subordinate's reference station", async () => {
    const station = await findCurrentStation("PCT0236");
    const { events } = station.getEventsPrediction(span);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "maxFlood")).toBe(true);
  });

  test("throws for an unknown station", async () => {
    await expect(findCurrentStation("nope")).rejects.toThrow("Current station not found: nope");
  });

  test("finds a secondary bin by its id", async () => {
    const station = await findCurrentStation("noaa/ACT8851@2");
    expect(station.id).toBe("noaa/ACT8851@2");
    expect(station.getEventsPrediction(span).events.length).toBeGreaterThan(0);
  });

  test("finds a CHS station but refuses to predict it", async () => {
    const station = await findCurrentStation("chs-active-pass");
    expect(station.name).toMatch(/Active Pass/);
    expect(() => station.getEventsPrediction(span)).toThrow(
      /Canadian Hydrographic Service.*tides\.gc\.ca/,
    );
    expect(() => station.getTimelinePrediction(span)).toThrow(/Canadian Hydrographic Service/);
  });

  test("refuses to predict a station with nothing to predict from", async () => {
    const station = await findCurrentStation("noaa-boundary-pass");
    expect(() => station.getEventsPrediction(span)).toThrow(
      /no harmonic constituents or subordinate offsets/,
    );
  });

  test("leaves out a direction the station doesn't publish", async () => {
    // noaa/ACT3681 publishes a flood direction but no ebb direction.
    const { events } = (await findCurrentStation("noaa/ACT3681")).getEventsPrediction(span);
    expect(events.some((e) => e.kind === "maxEbb")).toBe(true);
    for (const event of events) {
      if (event.kind === "maxFlood") expect(event.direction).toBe(10);
      else expect(event).not.toHaveProperty("direction");
    }
  });

  test("tide station ids are not current stations", async () => {
    await expect(findCurrentStation("noaa/8722588")).rejects.toThrow(/not found/);
  });
});

describe("currentStationUnavailable", () => {
  test("is undefined for a station that can be predicted", async () => {
    expect(await currentStationUnavailable(byId("noaa/PUG1701")!)).toBeUndefined();
    expect(await currentStationUnavailable(byId("noaa/PCT0236")!)).toBeUndefined();
  });

  test("refuses CHS stations for redistribution", async () => {
    const refusal = await currentStationUnavailable(byId("chs-active-pass")!);
    expect(refusal?.reason).toBe("redistribution");
    expect(refusal?.message).toMatch(/Canadian Hydrographic Service/);
  });

  test("refuses stations with nothing to predict from", async () => {
    const refusal = await currentStationUnavailable(byId("noaa-boundary-pass")!);
    expect(refusal?.reason).toBe("no-model");
  });

  test.each(["test/missing", "chs-active-pass"])(
    "refuses a subordinate whose reference %s has no constituents",
    async (reference) => {
      const subordinate = {
        name: "Test Subordinate",
        source: { name: "US National Oceanic and Atmospheric Administration" },
        harmonic_constituents: [],
        current: { offsets: { reference } },
      } as unknown as Parameters<typeof currentStationUnavailable>[0];
      const refusal = await currentStationUnavailable(subordinate);
      expect(refusal?.reason).toBe("no-model");
      expect(refusal?.message).toContain(`subordinate to ${reference}`);
    },
  );
});

describe("parseCurrentBin", () => {
  test("splits a secondary bin id", async () => {
    expect(parseCurrentBin("noaa/EPT0003@11")).toEqual({ base: "noaa/EPT0003", bin: 11 });
    expect(parseCurrentBin("noaa/EPT0003@0")).toEqual({ base: "noaa/EPT0003", bin: 0 });
  });

  test("treats a bare id as the primary bin", async () => {
    expect(parseCurrentBin("noaa/EPT0003")).toEqual({ base: "noaa/EPT0003" });
    expect(parseCurrentBin("noaa/EPT0003@01")).toEqual({ base: "noaa/EPT0003@01" });
  });
});
