import { describe, test, expect } from "vitest";
import { stations, stationsById } from "@slackwater/database";
import { useStation, useCurrentStation } from "../src/station.js";
import mockConstituents from "./_mocks/constituents.js";
import { loadFixture, type FixtureEvent } from "./_mocks/currents-catalog.js";
import type { Station, StationPredictor, CurrentStation } from "../src/station.js";

function findStation(query: string): StationPredictor {
  const found = stations.find((s) => s.id === query || s.source.id === query);
  if (!found) throw new Error(`Station not found: ${query}`);
  return useStation(found as Station);
}

const baseStation: Station = {
  id: "test/station",
  name: "Test Station",
  continent: "North America",
  country: "US",
  timezone: "America/New_York",
  disclaimers: "",
  latitude: 0,
  longitude: 0,
  source: { name: "test", id: "station", url: "" },
  datums: { MSL: 0, MLLW: -0.5, MHHW: 0.5 },
  chart_datum: "MLLW",
  type: "reference",
  harmonic_constituents: mockConstituents,
};

describe("useStation", () => {
  describe("nodeCorrections", () => {
    const station = findStation("noaa/8722588");
    const corrections = ["iho", "schureman"] as const;

    test("getExtremesPrediction produces different results", () => {
      const options = {
        start: new Date("2025-12-17T00:00:00Z"),
        end: new Date("2025-12-18T00:00:00Z"),
        datum: "MLLW",
      };

      const [iho, schureman] = corrections.map((nodeCorrections) =>
        station.getExtremesPrediction({ ...options, nodeCorrections }),
      );

      expect(iho.extremes.length).toBeGreaterThan(0);
      expect(schureman.extremes.length).toBeGreaterThan(0);
      expect(iho.extremes.map((e) => e.level)).not.toEqual(schureman.extremes.map((e) => e.level));
    });

    test("getTimelinePrediction produces different results", () => {
      const options = {
        start: new Date("2025-12-19T00:00:00Z"),
        end: new Date("2025-12-19T01:00:00Z"),
      };

      const [iho, schureman] = corrections.map((nodeCorrections) =>
        station.getTimelinePrediction({ ...options, nodeCorrections }),
      );

      expect(iho.timeline.length).toBeGreaterThan(0);
      expect(schureman.timeline.length).toBeGreaterThan(0);
      expect(iho.timeline.map((e) => e.level)).not.toEqual(schureman.timeline.map((e) => e.level));
    });

    test("getWaterLevelAtTime produces different results", () => {
      const options = { time: new Date("2025-12-19T00:30:00Z"), datum: "MLLW" };
      const [iho, schureman] = corrections.map((nodeCorrections) =>
        station.getWaterLevelAtTime({ ...options, nodeCorrections }),
      );
      expect(iho.level).not.toBe(schureman.level);
    });
  });

  describe("datum", () => {
    test("defaults to station's chart datum", () => {
      const noaa = findStation("noaa/8722274").getExtremesPrediction({
        start: new Date("2025-12-17T00:00:00Z"),
        end: new Date("2025-12-18T00:00:00Z"),
      });
      expect(noaa.datum).toBe("MLLW");

      const aus = findStation("ticon/fremantle-62230-aus-bom").getExtremesPrediction({
        start: new Date("2025-12-17T00:00:00Z"),
        end: new Date("2025-12-18T00:00:00Z"),
      });
      expect(aus.datum).toBe("LAT");
    });

    test("accepts datum option", () => {
      const extremes = findStation("8722274").getExtremesPrediction({
        start: new Date("2025-12-17T00:00:00Z"),
        end: new Date("2025-12-18T00:00:00Z"),
        datum: "NAVD88",
      });
      expect(extremes.datum).toBe("NAVD88");
    });

    test("throws error for unavailable datum", () => {
      const station = findStation("noaa/8443970");
      expect(() => {
        station.getExtremesPrediction({
          start: new Date("2025-12-17T00:00:00Z"),
          end: new Date("2025-12-18T00:00:00Z"),
          datum: "UNKNOWN_DATUM",
        });
      }).toThrow(/missing UNKNOWN_DATUM/);
    });

    test("throws error when missing MSL datum", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { MSL: _, ...datums } = baseStation.datums;
      const station = { ...baseStation, datums };
      expect(() => {
        useStation(station).getExtremesPrediction({
          start: new Date("2025-12-17T00:00:00Z"),
          end: new Date("2025-12-18T00:00:00Z"),
          datum: Object.keys(datums)[0],
        });
      }).toThrow(/missing MSL/);
    });

    test("does not apply datums when none available", () => {
      const stationData = stations.find(
        (s) =>
          s.kind === "tide" &&
          s.type === "reference" &&
          Object.entries(s.datums).length === 0 &&
          s.harmonic_constituents.length > 0,
      );
      if (!stationData) expect.fail("No station without datums found");
      const station = useStation(stationData as Station);
      const extremes = station.getExtremesPrediction({
        start: new Date("2025-12-17T00:00:00Z"),
        end: new Date("2025-12-18T00:00:00Z"),
      });
      expect(extremes.datum).toBeUndefined();
      expect(extremes.extremes.length).toBeGreaterThan(0);
    });
  });

  describe("subordinate station", () => {
    const station = findStation("8724307");

    test("has datums and harmonic_constituents matching the reference station", () => {
      expect(station.type).toBe("subordinate");
      const reference = findStation("8724580");

      expect(station.datums).toBeDefined();
      expect(station.datums).toEqual(reference.datums);
      expect(station.harmonic_constituents).toBeDefined();
      expect(station.harmonic_constituents).toEqual(reference.harmonic_constituents);
      expect(station.defaultDatum).toBe("MLLW");
    });

    describe("getExtremesPrediction", () => {
      test("matches NOAA extremes for subordinate station", () => {
        const start = new Date("2025-12-17T00:00:00Z");
        const end = new Date("2025-12-19T00:00:00Z");

        const prediction = station.getExtremesPrediction({
          start,
          end,
          datum: "MLLW",
        });

        // https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8724307&format=json&product=predictions&units=metric&time_zone=gmt&begin_date=2025-12-17&end_date=2025-12-18&interval=hilo&datum=MLLW
        const noaa = [
          { t: "2025-12-17T02:55:00z", v: 1.128, type: "H" },
          { t: "2025-12-17T10:57:00z", v: -0.044, type: "L" },
          { t: "2025-12-17T16:48:00z", v: 0.658, type: "H" },
          { t: "2025-12-17T22:04:00z", v: 0.337, type: "L" },
          { t: "2025-12-18T03:33:00z", v: 1.148, type: "H" },
          { t: "2025-12-18T11:35:00z", v: -0.099, type: "L" },
          { t: "2025-12-18T17:25:00z", v: 0.64, type: "H" },
          { t: "2025-12-18T22:40:00z", v: 0.316, type: "L" },
        ];

        noaa.forEach((expected, index) => {
          const actual = prediction.extremes[index];
          expect(actual.time).toBeWithin(new Date(expected.t).valueOf(), 5 * 60 * 1000);
          expect(actual.level).toBeWithin(expected.v, 0.04);
        });
      });
    });

    describe("getTimelinePrediction", () => {
      test("returns interpolated timeline", () => {
        const prediction = station.getTimelinePrediction({
          start: new Date("2025-12-17T00:00:00Z"),
          end: new Date("2025-12-17T01:00:00Z"),
          datum: "MLLW",
        });

        expect(prediction.timeline.length).toBe(7); // 10-min intervals for 1 hour
        expect(prediction.datum).toBe("MLLW");
        expect(prediction.units).toBe("meters");
        prediction.timeline.forEach((point) => {
          expect(typeof point.level).toBe("number");
          expect(point.level).not.toBeNaN();
        });
      });

      test("timeline levels are consistent with extremes", () => {
        const start = new Date("2025-12-17T00:00:00Z");
        const end = new Date("2025-12-18T00:00:00Z");

        const { extremes } = station.getExtremesPrediction({ start, end, datum: "MLLW" });
        const { timeline } = station.getTimelinePrediction({ start, end, datum: "MLLW" });

        const timelineLevels = timeline.map((p) => p.level);
        const highExtremes = extremes.filter((e) => e.high).map((e) => e.level);
        const lowExtremes = extremes.filter((e) => e.low).map((e) => e.level);

        expect(Math.max(...timelineLevels)).toBeLessThanOrEqual(Math.max(...highExtremes) + 0.01);
        expect(Math.min(...timelineLevels)).toBeGreaterThanOrEqual(Math.min(...lowExtremes) - 0.01);
      });

      test("tidal range is scaled by height offset ratios", () => {
        const start = new Date("2025-01-15T00:00:00Z");
        const end = new Date("2025-01-18T00:00:00Z");

        const reference = findStation("8724580");
        const { timeline: refTimeline } = reference.getTimelinePrediction({
          start,
          end,
          datum: "MLLW",
        });
        const { timeline: subTimeline } = station.getTimelinePrediction({
          start,
          end,
          datum: "MLLW",
        });

        // Height ratio offsets: high=2.13, low=1.83
        const refRange =
          Math.max(...refTimeline.map((p) => p.level)) -
          Math.min(...refTimeline.map((p) => p.level));
        const subRange =
          Math.max(...subTimeline.map((p) => p.level)) -
          Math.min(...subTimeline.map((p) => p.level));
        const rangeRatio = subRange / refRange;

        expect(rangeRatio).toBeGreaterThan(1.83);
        expect(rangeRatio).toBeLessThan(2.13);
      });
    });

    describe("getWaterLevelAtTime", () => {
      test("returns water level at specific time", () => {
        const prediction = station.getWaterLevelAtTime({
          time: new Date("2025-12-17T12:00:00Z"),
          datum: "MLLW",
        });

        expect(prediction.time).toEqual(new Date("2025-12-17T12:00:00Z"));
        expect(prediction.datum).toBe("MLLW");
        expect(typeof prediction.level).toBe("number");
        expect(prediction.level).not.toBeNaN();
      });
    });
  });

  describe("subordinate vs reference curve comparison", () => {
    const start = new Date("2025-01-15T00:00:00Z");
    const end = new Date("2025-01-18T00:00:00Z");

    function rmsError(a: { level: number }[], b: { level: number }[]): number {
      let sumSq = 0;
      for (let i = 0; i < a.length; i++) {
        const diff = a[i].level - b[i].level;
        sumSq += diff * diff;
      }
      return Math.sqrt(sumSq / a.length);
    }

    function tidalRange(timeline: { level: number }[]): number {
      const levels = timeline.map((p) => p.level);
      return Math.max(...levels) - Math.min(...levels);
    }

    describe("identity offsets (Cabrillo Beach: height=1.0/1.0, time=0/0)", () => {
      const sub = findStation("9410650");
      const ref = findStation(sub.offsets!.reference!);

      test("timeline matches reference curve", () => {
        const { timeline: refTimeline } = ref.getTimelinePrediction({ start, end });
        const { timeline: subTimeline } = sub.getTimelinePrediction({ start, end });

        expect(subTimeline.length).toBe(refTimeline.length);
        expect(rmsError(subTimeline, refTimeline) / tidalRange(refTimeline)).toBeLessThan(0.05);
      });

      test("extremes match reference", () => {
        const { extremes: refExtremes } = ref.getExtremesPrediction({ start, end });
        const { extremes: subExtremes } = sub.getExtremesPrediction({ start, end });

        expect(subExtremes.length).toBe(refExtremes.length);
        for (let i = 0; i < refExtremes.length; i++) {
          expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level, 2);
          expect(subExtremes[i].high).toBe(refExtremes[i].high);
        }
      });
    });

    describe("time-only offsets (Hanauma Bay: height=1.0/1.0, time=-59/-45 min)", () => {
      const sub = findStation("1612301");
      const ref = findStation(sub.offsets!.reference!);

      test("timeline has same tidal range as reference", () => {
        const { timeline: refTimeline } = ref.getTimelinePrediction({ start, end });
        const { timeline: subTimeline } = sub.getTimelinePrediction({ start, end });

        const refRange = tidalRange(refTimeline);
        const subRange = tidalRange(subTimeline);
        expect(subRange / refRange).toBeGreaterThan(0.95);
        expect(subRange / refRange).toBeLessThan(1.05);
      });

      test("extremes are time-shifted but same height as reference", () => {
        const { extremes: refExtremes } = ref.getExtremesPrediction({ start, end });
        const { extremes: subExtremes } = sub.getExtremesPrediction({ start, end });

        expect(subExtremes.length).toBe(refExtremes.length);
        for (let i = 0; i < refExtremes.length; i++) {
          expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level, 2);
          const timeDiffMin =
            (subExtremes[i].time.getTime() - refExtremes[i].time.getTime()) / 60000;
          const expectedOffset = subExtremes[i].high ? -59 : -45;
          expect(timeDiffMin).toBeCloseTo(expectedOffset, 0);
        }
      });
    });

    describe("height-only offsets (Great Diamond Island: height=1.0/1.03, time=0/0)", () => {
      const sub = findStation("8417988");
      const ref = findStation(sub.offsets!.reference!);

      test("extremes occur at same times as reference", () => {
        const { extremes: refExtremes } = ref.getExtremesPrediction({ start, end });
        const { extremes: subExtremes } = sub.getExtremesPrediction({ start, end });

        expect(subExtremes.length).toBe(refExtremes.length);
        for (let i = 0; i < refExtremes.length; i++) {
          expect(subExtremes[i].time.getTime()).toBe(refExtremes[i].time.getTime());
          if (subExtremes[i].high) {
            expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level, 2);
          } else {
            expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level * 1.03, 2);
          }
        }
      });

      test("timeline closely follows reference curve", () => {
        const { timeline: refTimeline } = ref.getTimelinePrediction({ start, end });
        const { timeline: subTimeline } = sub.getTimelinePrediction({ start, end });

        expect(rmsError(subTimeline, refTimeline) / tidalRange(refTimeline)).toBeLessThan(0.1);
      });
    });
  });
});

describe("useCurrentStation", () => {
  const start = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-06-02T00:00:00Z");

  function dbCurrentStation(id: string): CurrentStation {
    const found = stationsById.get(id);
    if (!found) throw new Error(`Station not found: ${id}`);
    return found as CurrentStation;
  }

  const baseCurrentStation: CurrentStation = {
    ...baseStation,
    id: "test/current",
    kind: "current",
    datums: {},
    chart_datum: undefined,
    current: { flood_direction: 45, ebb_direction: 225, mean_flow: 0.1 },
  };

  describe("harmonic stations", () => {
    // PUG1716 is a NOAA type-S station that carries its own harcon: it must
    // be predicted harmonically, not by reduction.
    const station = useCurrentStation(dbCurrentStation("noaa/PUG1716"));

    test("predicts events with directions", () => {
      const { events, station: reported } = station.getEventsPrediction({ start, end });
      expect(reported.id).toBe("noaa/PUG1716");
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        if (event.kind === "maxFlood") expect(event.direction).toBeCloseTo(38.3, 3);
        if (event.kind === "maxEbb") expect(event.direction).toBeCloseTo(218.3, 3);
      }
    });

    test("predicts a signed timeline in knots", () => {
      const { timeline } = station.getTimelinePrediction({ start, end });
      expect(timeline.length).toBe(145); // 24 h at the default 600 s step
      expect(Math.min(...timeline.map((p) => p.speed))).toBeLessThan(0);
      expect(Math.max(...timeline.map((p) => p.speed))).toBeGreaterThan(0);
    });

    test("nodeCorrections produce different results", () => {
      const [iho, schureman] = (["iho", "schureman"] as const).map(
        (nodeCorrections) =>
          station.getTimelinePrediction({ start, end, nodeCorrections }).timeline,
      );
      expect(iho.map((p) => p.speed)).not.toEqual(schureman.map((p) => p.speed));
    });

    test("defaults directions and mean flow when the current block is absent", () => {
      const bare = useCurrentStation({ ...baseCurrentStation, current: undefined });
      const { events } = bare.getEventsPrediction({ start, end });
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        if (event.kind !== "slack") expect([0]).toContain(event.direction);
      }
    });
  });

  describe("subordinate stations", () => {
    const pct0236 = dbCurrentStation("noaa/PCT0236");
    const reference = dbCurrentStation(pct0236.current!.offsets!.reference);
    const station = useCurrentStation(pct0236, { reference, distance: 1.5 });

    test("matches NOAA within the subordinate tolerances", () => {
      // The database offsets are minutes; the fixture describes the same
      // station with second offsets. Matching NOAA proves the conversion.
      const fx = loadFixture<{ events: FixtureEvent[] }>("currents-golden-subordinate");
      const times = fx.events.map((e) => Date.parse(e.time));
      const { events, distance } = station.getEventsPrediction({
        start: new Date(Math.min(...times) - 3_600_000),
        end: new Date(Math.max(...times) + 3_600_000),
      });
      expect(distance).toBe(1.5);

      for (const event of fx.events) {
        if (event.kind === "slack") continue;
        const time = Date.parse(event.time);
        const match = events
          .filter((e) => e.kind === event.kind)
          .reduce((a, b) =>
            Math.abs(a.time.getTime() - time) < Math.abs(b.time.getTime() - time) ? a : b,
          );
        expect(Math.abs(match.time.getTime() - time) / 60_000).toBeLessThan(30);
        expect(Math.abs(Math.abs(match.speed) - Math.abs(event.speed))).toBeLessThan(0.4);
      }
    });

    test("draws a half-cosine timeline through the events", () => {
      const { timeline } = station.getTimelinePrediction({ start, end, timeFidelity: 3600 });
      expect(timeline.length).toBe(25);
      expect(Math.min(...timeline.map((p) => p.speed))).toBeLessThan(0);
      expect(Math.max(...timeline.map((p) => p.speed))).toBeGreaterThan(0);
    });

    test("defaults missing offset fields to identity", () => {
      const minimal = useCurrentStation(
        {
          ...baseCurrentStation,
          harmonic_constituents: [],
          current: { offsets: { reference: "test/reference" } },
        },
        { reference: baseCurrentStation },
      );
      const { events } = minimal.getEventsPrediction({ start, end });
      // Identity offsets: same times as the reference, slacks zeroed. The
      // reference list covers whole UTC days; trim it as the subordinate does.
      const refEvents = useCurrentStation(baseCurrentStation)
        .getEventsPrediction({ start, end })
        .events.filter((e) => e.kind !== "slack" && e.time >= start && e.time <= end);
      const maxima = events.filter((e) => e.kind !== "slack");
      expect(maxima.map((e) => e.time)).toEqual(refEvents.map((e) => e.time));
      expect(maxima.map((e) => e.speed)).toEqual(refEvents.map((e) => e.speed));
    });
  });

  describe("unpredictable stations", () => {
    test("throws without constituents or offsets", () => {
      const station = useCurrentStation({
        ...baseCurrentStation,
        harmonic_constituents: [],
        current: {},
      });
      expect(() => station.getEventsPrediction({ start, end })).toThrow(
        /neither harmonic constituents nor subordinate offsets/,
      );
    });

    test("throws when a subordinate's reference is not provided", () => {
      const station = useCurrentStation({
        ...baseCurrentStation,
        harmonic_constituents: [],
        current: { offsets: { reference: "test/reference" } },
      });
      expect(() => station.getTimelinePrediction({ start, end })).toThrow(
        /pass that station as options\.reference/,
      );
    });

    test("throws when the reference has no constituents", () => {
      const station = useCurrentStation(
        {
          ...baseCurrentStation,
          harmonic_constituents: [],
          current: { offsets: { reference: "test/reference" } },
        },
        { reference: { ...baseCurrentStation, harmonic_constituents: [] } },
      );
      expect(() => station.getEventsPrediction({ start, end })).toThrow(
        /has no harmonic constituents/,
      );
    });
  });
});
