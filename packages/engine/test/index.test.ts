import { describe, it, expect } from "vitest";
import mockConstituents from "./_mocks/constituents.js";
import { createTidePredictor, type TidePrediction } from "../src/index.js";
import type { ExtremeOffsets } from "../src/harmonics/index.js";

const startDate = new Date("2019-09-01T00:00:00Z");
const endDate = new Date("2019-09-01T06:00:00Z");

describe("Tidal station", () => {
  it("it is created correctly", () => {
    let stationCreated = true;

    try {
      createTidePredictor(mockConstituents);
    } catch {
      stationCreated = false;
    }
    expect(stationCreated).toBe(true);

    try {
      createTidePredictor(mockConstituents);
    } catch {
      stationCreated = false;
    }
    expect(stationCreated).toBe(true);
  });

  it("it predicts the tides in a timeline", () => {
    const results = createTidePredictor(mockConstituents).getTimelinePrediction({
      start: startDate,
      end: endDate,
    });
    expect(results.length).toBe(37);
    expect(results[0].level).toBeCloseTo(-1.46903456, 3);
    const lastResult = results.pop();
    expect(lastResult?.level).toBeCloseTo(2.83490872, 3);
  });

  it("it predicts the tides in a timeline with time fidelity", () => {
    const results = createTidePredictor(mockConstituents).getTimelinePrediction({
      start: startDate,
      end: endDate,
      timeFidelity: 60,
    });
    expect(results.length).toBe(361);
    expect(results[0].level).toBeCloseTo(-1.46903456, 3);
    const lastResult = results.pop();
    expect(lastResult?.level).toBeCloseTo(2.83490872, 3);
  });

  it("it predicts the tidal extremes", () => {
    const results = createTidePredictor(mockConstituents).getExtremesPrediction({
      start: startDate,
      end: endDate,
    });
    expect(results[0].level).toBeCloseTo(-1.67283933, 4);
  });

  it("it fetches a single water level", () => {
    const result = createTidePredictor(mockConstituents).getWaterLevelAtTime({
      time: startDate,
    });
    expect(result.level).toBeCloseTo(-1.46903456, 4);
  });

  describe("water level between timeline steps", () => {
    const time = new Date("2026-06-01T03:09:00Z");
    // 03:09 lies on the one-minute grid, so this timeline's first point is unsnapped.
    const levelAt = (predictor: TidePrediction, offsets?: ExtremeOffsets) =>
      predictor.getTimelinePrediction({
        start: time,
        end: new Date(time.getTime() + 60 * 1000),
        timeFidelity: 60,
        offsets,
      })[0].level;

    it("evaluates a reference station at the requested time", () => {
      const predictor = createTidePredictor([{ name: "M2", amplitude: 1, phase: 0 }]);
      const result = predictor.getWaterLevelAtTime({ time });
      expect(result.time).toEqual(time);
      expect(result.level).toBeCloseTo(0.234, 3);
      expect(result.level).toBeCloseTo(levelAt(predictor), 6);
    });

    it("evaluates a subordinate station at the requested time", () => {
      const predictor = createTidePredictor(mockConstituents);
      const offsets: ExtremeOffsets = {
        height: { high: 1.1, low: 0.9, type: "ratio" },
        time: { high: 15, low: 20 },
      };
      const result = predictor.getWaterLevelAtTime({ time, offsets });
      expect(result.time).toEqual(time);
      expect(result.level).toBeCloseTo(levelAt(predictor, offsets), 6);
    });
  });

  it("it adds offset phases", () => {
    const results = createTidePredictor(mockConstituents, {
      offset: 3,
    }).getExtremesPrediction({ start: startDate, end: endDate });

    expect(results[0].level).toBeCloseTo(1.32716067, 4);
  });

  it("equivalent instants in different timezones yield identical extremes", () => {
    const predictor = createTidePredictor(mockConstituents);

    const utc = { start: new Date("2019-09-01T00:00:00Z"), end: new Date("2019-09-01T06:00:00Z") };
    const newYork = {
      start: new Date("2019-08-31T20:00:00-04:00"),
      end: new Date("2019-09-01T02:00:00-04:00"),
    };
    const tokyo = {
      start: new Date("2019-09-01T09:00:00+09:00"),
      end: new Date("2019-09-01T15:00:00+09:00"),
    };

    const baseline = predictor.getExtremesPrediction(utc);
    const ny = predictor.getExtremesPrediction(newYork);
    const jp = predictor.getExtremesPrediction(tokyo);

    [ny, jp].forEach((result) => {
      expect(result.length).toBe(baseline.length);
      result.forEach((extreme, index) => {
        expect(extreme.time.valueOf()).toBe(baseline[index].time.valueOf());
        expect(extreme.level).toBeCloseTo(baseline[index].level, 6);
      });
    });
  });
});
