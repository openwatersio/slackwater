import { describe, expect, test } from "vitest";
import {
  createCurrentPredictor,
  createSubordinateCurrentPredictor,
  useCurrentStation,
} from "../src/index.js";
import type { CurrentPredictionOptions } from "../src/index.js";
import type { CurrentStationData } from "../src/station.js";
import { loadStations } from "@slackwater/database";
import noaa from "../../../fixtures/currents-vector-noaa.json";

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-04T00:00:00Z");
const span = { start, end, timeFidelity: 10800 };
const major = [{ name: "S2", amplitude: 2, phase: 0 }];
const minor = [{ name: "S2", amplitude: 1, phase: 90 }];

describe("current vectors", () => {
  test("matches NOAA speed and direction for Bellingham Channel", () => {
    const points = createCurrentPredictor(noaa.constituents, noaa).getTimelinePrediction({
      start: new Date(noaa.start),
      end: new Date(noaa.end),
      timeFidelity: noaa.timeFidelity,
    });
    expect(points).toHaveLength(noaa.timeline.length);
    let significant = 0;
    for (const [index, expected] of noaa.timeline.entries()) {
      const point = points[index];
      expect(point.time).toEqual(new Date(expected.time));
      expect(Math.abs(point.magnitude! - expected.magnitude)).toBeLessThan(0.15);
      if (expected.magnitude >= 0.75) {
        significant++;
        const difference = Math.abs(point.direction! - expected.direction) % 360;
        expect(Math.min(difference, 360 - difference)).toBeLessThan(5);
      }
    }
    expect(significant).toBe(34);
  });
  test("rotates clockwise through the minor axis without changing speed or events", () => {
    const options = {
      floodDirection: 10,
      ebbDirection: 200,
      azimuth: 350,
      minorConstituents: minor,
    };
    const vector = createCurrentPredictor(major, options);
    const points = vector.getTimelinePrediction(span);
    for (const [index, magnitude, direction] of [
      [0, 2, 350],
      [1, 1, 80],
      [2, 2, 170],
      [3, 1, 260],
    ]) {
      expect(points[index].magnitude).toBeCloseTo(magnitude, 8);
      expect(points[index].direction).toBeCloseTo(direction, 8);
    }
    const axial = createCurrentPredictor(major, { floodDirection: 10, ebbDirection: 200 });
    expect(points.map((p) => p.speed)).toEqual(
      axial.getTimelinePrediction(span).map((p) => p.speed),
    );
    expect(vector.getEventsPrediction(span)).toEqual(axial.getEventsPrediction(span));
    expect(vector.getEventsPrediction(span).filter((e) => e.kind === "slack")).not.toHaveLength(0);
  });

  test.each([
    [3, 4, 0, 5, 53.13010235415598],
    [-3, 4, 0, 5, 126.86989764584402],
    [-3, -4, 0, 5, 233.13010235415598],
    [3, -4, 0, 5, 306.86989764584405],
    [0, 4, -90, 4, 0],
    [0, -4, 450, 4, 0],
  ])("combines constant flow (%s, %s) at azimuth %s", (u, v, azimuth, magnitude, direction) => {
    const [point] = createCurrentPredictor([], {
      meanFlow: u,
      minorMeanFlow: v,
      azimuth,
    }).getTimelinePrediction(span);
    expect(point.speed).toBe(u);
    expect(point.magnitude).toBe(magnitude);
    expect(point.direction).toBeCloseTo(direction, 10);
  });

  test.each([
    [{ meanFlow: 2, floodDirection: 30 }, 2, 30],
    [{ meanFlow: -2, floodDirection: 30, ebbDirection: 225 }, 2, 225],
    [{ meanFlow: -2, floodDirection: 30 }, 2, undefined],
    [{ meanFlow: 2 }, 2, undefined],
    [{ meanFlow: 0, floodDirection: 30, ebbDirection: 225 }, 0, undefined],
    [{ minorConstituents: [], floodDirection: 30 }, 0, undefined],
    [{ meanFlow: 3, minorMeanFlow: 4 }, 5, undefined],
    [{ meanFlow: -2, minorConstituents: [], floodDirection: 30, ebbDirection: 225 }, 2, 225],
    [{ meanFlow: -2, minorConstituents: [], ebbDirection: 225 }, 2, 225],
    [
      {
        meanFlow: -2,
        minorConstituents: [{ name: "UNKNOWN", amplitude: 1, phase: 0 }],
        floodDirection: 30,
        ebbDirection: 225,
      },
      2,
      225,
    ],
    [
      {
        meanFlow: -2,
        minorConstituents: [{ name: "M2", amplitude: 0, phase: 0 }],
        floodDirection: 30,
        ebbDirection: 225,
      },
      2,
      225,
    ],
  ] satisfies [CurrentPredictionOptions, number, number | undefined][])(
    "uses known bearings for %j",
    (options, magnitude, direction) => {
      const [point] = createCurrentPredictor([], options).getTimelinePrediction(span);
      expect(point.magnitude).toBe(magnitude);
      if (direction === undefined) expect(point).not.toHaveProperty("direction");
      else expect(point.direction).toBeCloseTo(direction, 10);
    },
  );

  test("uses the selected nodal corrections and means on both axes over several days", () => {
    const inputs = [
      { name: "M2", amplitude: 1, phase: 17 },
      { name: "UNKNOWN", amplitude: 20, phase: 0 },
    ];
    for (const nodeCorrections of ["iho", "schureman"] as const) {
      const vector = createCurrentPredictor(inputs, {
        minorConstituents: inputs,
        meanFlow: 0.25,
        minorMeanFlow: 0.25,
        azimuth: 0,
        nodeCorrections,
      });
      for (const point of vector.getTimelinePrediction(span)) {
        expect(point.magnitude).toBeCloseTo(Math.abs(point.speed) * Math.SQRT2, 10);
        expect(point.direction).toBeCloseTo(point.speed > 0 ? 45 : 225, 10);
      }
    }
  });

  test("subordinates use their own phase directions and absolute signed speed", () => {
    const reference = createCurrentPredictor(major, { minorConstituents: minor, azimuth: 350 });
    const offsets = {
      slackBeforeFloodOffset: 0,
      slackBeforeEbbOffset: 0,
      floodTimeOffset: 0,
      ebbTimeOffset: 0,
      floodSpeedRatio: 1,
      ebbSpeedRatio: 1,
    };
    for (const directions of [{ floodDirection: 20, ebbDirection: 205 }, {}]) {
      const points = createSubordinateCurrentPredictor(reference, {
        ...offsets,
        ...directions,
      }).getTimelinePrediction(span);
      for (const point of points) {
        expect(point.magnitude).toBe(Math.abs(point.speed));
        expect(point.direction).toBe(
          point.speed > 0
            ? directions.floodDirection
            : point.speed < 0
              ? directions.ebbDirection
              : undefined,
        );
      }
    }
  });

  test("station wrappers carry optional vector constants", async () => {
    const db = await loadStations();
    const base = db.accepted.find((s) => s.kind === "current")!;
    const station = useCurrentStation({
      ...base,
      kind: "current",
      harmonic_constituents: [{ name: "Z0", amplitude: 3, phase: 0 }],
      current: {
        minor_constituents: [{ name: "Z0", amplitude: 2, phase: 0 }],
        minor_mean_flow: 2,
        azimuth: 0,
      },
    });
    const [point] = station.getTimelinePrediction(span).timeline;
    expect(point.magnitude).toBe(5);
    expect(point.direction).toBeCloseTo(53.13010235415598, 10);
  });

  test("station wrappers treat nullable vector metadata as missing", async () => {
    const db = await loadStations();
    const base = db.accepted.find((s) => s.kind === "current")!;
    for (const [current, direction] of [
      ['{"minor_constituents":null,"minor_mean_flow":null,"azimuth":null}', 225],
      [
        '{"minor_constituents":[{"name":"Z0","amplitude":4,"phase":0}],"minor_mean_flow":null,"azimuth":null}',
        156.86989764584402,
      ],
    ] as const) {
      const station = useCurrentStation({
        ...base,
        kind: "current",
        harmonic_constituents: [{ name: "Z0", amplitude: 3, phase: 180 }],
        current: {
          flood_direction: 30,
          ebb_direction: 225,
          ...(JSON.parse(current) as CurrentStationData),
        },
      });
      const [point] = station.getTimelinePrediction(span).timeline;
      expect(point.direction).toBeCloseTo(direction, 10);
    }
  });
});
