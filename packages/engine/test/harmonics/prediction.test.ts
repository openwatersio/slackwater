import { describe, it, expect } from "vitest";
import harmonics, { ExtremeOffsets, getTimeline } from "../../src/harmonics/index.js";
import predictionFactory from "../../src/harmonics/prediction.js";
import { filterExtremes } from "../../src/harmonics/extremes.js";
import { createTidePredictor } from "../../src/index.js";
import defaultConstituentModels from "../../src/constituents/index.js";
import mockHarmonicConstituents from "../_mocks/constituents.js";

const startDate = new Date("2019-09-01T00:00:00Z");
const endDate = new Date("2019-09-01T06:00:00Z");
const extremesEndDate = new Date("2019-09-03T00:00:00Z");

const setUpPrediction = () => {
  const harmonic = harmonics({
    harmonicConstituents: mockHarmonicConstituents,
    offset: false,
  });
  harmonic.setTimeSpan(startDate, endDate);
  return harmonic.prediction();
};

describe("harmonic prediction", () => {
  it("it creates a timeline prediction", () => {
    const testPrediction = setUpPrediction();
    const results = testPrediction.getTimelinePrediction();
    const lastResult = results.pop();
    expect(results[0].level).toBeCloseTo(-1.46903456, 3);
    expect(lastResult?.level).toBeCloseTo(2.83490872, 3);
  });

  it("it finds high and low tides", () => {
    const results = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction();
    expect(results[0].level).toBeCloseTo(-1.67283933, 4);

    const customLabels = {
      high: "Super high",
      low: "Wayyy low",
    };

    const labelResults = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction({ labels: customLabels });
    expect(labelResults[0].label).toBe(customLabels.low);
  });

  it("it finds high and low tides with high fidelity", () => {
    const results = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction({ timeFidelity: 60 })
      .getExtremesPrediction();
    expect(results[0].level).toBeCloseTo(-1.67283933, 4);
  });
});

describe("unknown constituent handling", () => {
  it("silently skips unknown constituents in prepare()", () => {
    // Call predictionFactory directly with a constituent that has no model,
    // bypassing harmonicsFactory's filtering. This exercises the
    // `if (!model) return` guards in prepare() (lines 224, 237).
    const timeline = getTimeline(startDate, endDate);
    const constituents = [
      {
        name: "FAKE_CONSTITUENT",
        amplitude: 1.0,
        phase: 0,
        speed: 15.0,
      },
    ];

    const prediction = predictionFactory({
      timeline,
      constituents,
      constituentModels: defaultConstituentModels,
      start: startDate,
    });

    // Should not throw — unknown constituent is silently skipped in prepare()
    expect(() => prediction.getTimelinePrediction()).not.toThrow();
    expect(() => prediction.getExtremesPrediction()).not.toThrow();
  });
});

describe("getTimeline alignment", () => {
  it("snaps to epoch-aligned boundaries when start is unaligned", () => {
    const unalignedStart = new Date("2019-09-01T00:07:00Z");
    const end = new Date("2019-09-01T01:00:00Z");
    const timeline = getTimeline(unalignedStart, end, 600);

    // First point should be :00 (floor of :07), so requested time is within the timeline
    expect(timeline.items[0]).toEqual(new Date("2019-09-01T00:00:00Z"));
    expect(timeline.hours[0]).toBe(0);

    // All points should be on 10-minute boundaries
    for (const item of timeline.items) {
      expect(item.getMinutes() % 10).toBe(0);
      expect(item.getSeconds()).toBe(0);
    }

    // Last point should be :00
    expect(timeline.items[timeline.items.length - 1]).toEqual(new Date("2019-09-01T01:00:00Z"));
  });

  it("snaps to 6-minute boundaries", () => {
    const unalignedStart = new Date("2019-09-01T00:07:00Z");
    const end = new Date("2019-09-01T01:00:00Z");
    const timeline = getTimeline(unalignedStart, end, 360);

    // First point should be :06 (floor of :07 to 6-minute boundary)
    expect(timeline.items[0]).toEqual(new Date("2019-09-01T00:06:00Z"));

    // All points should be on 6-minute boundaries
    for (const item of timeline.items) {
      expect(item.getMinutes() % 6).toBe(0);
    }
  });

  it("snaps end time up to next aligned boundary", () => {
    const start = new Date("2019-09-01T00:00:00Z");
    const unalignedEnd = new Date("2019-09-01T00:53:00Z");
    const timeline = getTimeline(start, unalignedEnd, 600);

    // Last point should be :00 (ceil of :53 to next 10-minute boundary)
    expect(timeline.items[timeline.items.length - 1]).toEqual(new Date("2019-09-01T01:00:00Z"));
  });

  it("keeps start and end when already aligned", () => {
    const alignedStart = new Date("2019-09-01T00:00:00Z");
    const end = new Date("2019-09-01T01:00:00Z");
    const timeline = getTimeline(alignedStart, end, 600);

    expect(timeline.items[0]).toEqual(alignedStart);
    expect(timeline.hours[0]).toBe(0);
    expect(timeline.items.length).toBe(7);
  });
});

describe("prominence filtering", () => {
  it("filters spurious extremes from low-amplitude stations", () => {
    // Simulate a Baltic-like station dominated by seasonal constituents
    // with negligible semi-diurnal signal (like Vahemadal, Estonia)
    const lowAmpConstituents = [
      { name: "SA", amplitude: 0.06, phase: 277 },
      { name: "SSA", amplitude: 0.16, phase: 190 },
      { name: "M2", amplitude: 0.006, phase: 223 },
      { name: "K1", amplitude: 0.014, phase: 342 },
      { name: "O1", amplitude: 0.015, phase: 289 },
    ];

    const results = harmonics({
      harmonicConstituents: lowAmpConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction();

    // Without filtering this would produce ~12 spurious extremes in 2 days.
    // With prominence filtering, only significant level changes are kept.
    expect(results.length).toBeLessThanOrEqual(6);

    // All remaining extremes should differ by at least the default prominence threshold (0.01 m)
    for (let i = 0; i < results.length - 1; i++) {
      const diff = Math.abs(results[i + 1].level - results[i].level);
      expect(diff).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("preserves all extremes for normal tidal stations", () => {
    // The mock constituents have large amplitudes (M2: 1.61m, K1: 1.2m)
    // so no extremes should be filtered
    const results = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction();

    // 2 days should produce ~8 extremes for a mixed semidiurnal signal
    expect(results.length).toBeGreaterThanOrEqual(7);
    expect(results.length).toBeLessThanOrEqual(9);
    expect(results[0].level).toBeCloseTo(-1.67283933, 4);
  });

  // Victoria-like mixed tide: small stands on the falling tide are common here.
  const mixedTide = [
    { name: "M2", amplitude: 0.37, phase: 20 },
    { name: "S2", amplitude: 0.1, phase: 40 },
    { name: "N2", amplitude: 0.09, phase: 355 },
    { name: "K2", amplitude: 0.03, phase: 40 },
    { name: "K1", amplitude: 0.63, phase: 260 },
    { name: "O1", amplitude: 0.38, phase: 240 },
    { name: "P1", amplitude: 0.19, phase: 258 },
    { name: "Q1", amplitude: 0.07, phase: 235 },
  ];
  // (M4 + MS4) / M2 ≈ 0.3 meets the Doodson double-tide criterion.
  const mixedDoubleTide = [
    ...mixedTide,
    { name: "M4", amplitude: 0.08, phase: 100 },
    { name: "MS4", amplitude: 0.03, phase: 150 },
  ];

  it.each([
    ["default threshold", mixedTide, undefined],
    ["NOAA 0.03 m threshold", mixedTide, 0.03],
    ["double tide", mixedDoubleTide, undefined],
  ])("alternates highs and lows over a 19-year mixed tide (%s)", (_, constituents, threshold) => {
    const results = harmonics({ harmonicConstituents: constituents, offset: false })
      .setTimeSpan(new Date("2020-01-01T00:00:00Z"), new Date("2039-01-01T00:00:00Z"))
      .prediction({ prominenceThreshold: threshold })
      .getExtremesPrediction();

    const repeats = results.filter((e, i) => i > 0 && e.high === results[i - 1].high);
    expect(repeats).toEqual([]);
  });
});

describe("filterExtremes", () => {
  const extreme = (hour: number, level: number, high: boolean) => ({
    time: new Date(hour * 3600000),
    level,
    high,
    low: !high,
    label: high ? "High" : "Low",
  });
  const levels = (extremes: { level: number }[]) => extremes.map((e) => e.level);

  it("removes a stand on the falling tide as a low-high pair", () => {
    const results = filterExtremes(
      [
        extreme(0, -0.926, false),
        extreme(8, 0.945, true),
        extreme(17, -0.112, false),
        extreme(17.5, -0.109, true),
        extreme(24, -0.72, false),
      ],
      0.01,
    );
    expect(levels(results)).toEqual([-0.926, 0.945, -0.72]);
  });

  it("keeps the higher high of a double high water with a shallow dip", () => {
    const results = filterExtremes(
      [
        extreme(0, 0, false),
        extreme(6, 1.002, true),
        extreme(7, 0.995, false),
        extreme(8, 1.0, true),
        extreme(14, 0, false),
      ],
      0.01,
    );
    expect(levels(results)).toEqual([0, 1.002, 0]);
  });

  it("keeps a double high water whose dip clears the threshold", () => {
    const input = [
      extreme(0, 0, false),
      extreme(6, 1.0, true),
      extreme(7, 0.95, false),
      extreme(8, 1.02, true),
      extreme(14, 0, false),
    ];
    expect(filterExtremes(input, 0.01)).toEqual(input);
  });

  it("never removes the first or last extreme", () => {
    const input = [
      extreme(0, 1.0, true),
      extreme(1, 0.999, false),
      extreme(4, 1.5, true),
      extreme(10, -1, false),
      extreme(11, -0.9995, true),
    ];
    expect(filterExtremes(input, 0.01)).toEqual(input);
  });

  it("keeps a double high's first high when its second lies past the end", () => {
    const results = filterExtremes(
      [extreme(0, 0, false), extreme(6, 1.002, true), extreme(7, 0.995, false)],
      0.01,
    );
    expect(levels(results)).toContain(1.002);
  });

  it("keeps a double high's second high when its first lies before the start", () => {
    const results = filterExtremes(
      [extreme(7, 0.995, false), extreme(8, 1.0, true), extreme(14, 0, false)],
      0.01,
    );
    expect(levels(results)).toContain(1.0);
  });

  it("drops one copy of a turn found twice", () => {
    const results = filterExtremes(
      [
        extreme(0, -0.4, false),
        extreme(7.6, 0.03, true),
        extreme(7.6005, 0.03, true),
        extreme(10.4, -0.008, false),
      ],
      0.01,
    );
    expect(results.map((e) => e.high)).toEqual([false, true, false]);
  });
});

describe("extremes at the edges of the window", () => {
  // M4 just over a quarter of M2 and in opposition splits every high into two with a
  // dip of a few millimetres; the faint M8 shortens the bracket enough to resolve it.
  const doubleHigh = [
    { name: "M2", amplitude: 1, phase: 0 },
    { name: "M4", amplitude: 0.29, phase: 180.5 },
    { name: "M8", amplitude: 0.001, phase: 0 },
  ];
  const extremesBetween = (start: string, end: string) =>
    harmonics({ harmonicConstituents: doubleHigh, offset: false })
      .setTimeSpan(new Date(start), new Date(end))
      .prediction()
      .getExtremesPrediction();
  const long = extremesBetween("2024-12-31T00:00:00Z", "2025-01-03T00:00:00Z");

  // On 2025-01-01 the double highs fall at 00:18 / 01:18 / 02:04 and 12:43 / 13:44 / 14:29.
  it.each([
    ["starts before the dip", "2025-01-01T01:00:00Z", "2025-01-01T10:00:00Z"],
    ["starts after the dip", "2025-01-01T02:00:00Z", "2025-01-01T10:00:00Z"],
    ["ends before the dip", "2025-01-01T06:00:00Z", "2025-01-01T13:10:00Z"],
    ["ends after the dip", "2025-01-01T06:00:00Z", "2025-01-01T14:00:00Z"],
  ])("matches a longer run when the window %s of a double high", (_, start, end) => {
    const short = extremesBetween(start, end);
    const expected = long.filter((e) => e.time >= new Date(start) && e.time <= new Date(end));

    expect(short.map((e) => e.high)).toEqual(expected.map((e) => e.high));
    short.forEach((e, i) => {
      expect(Math.abs(e.time.getTime() - expected[i].time.getTime())).toBeLessThan(5000);
      expect(e.level).toBeCloseTo(expected[i].level, 4);
    });
  });
});

describe("extremes edge cases", () => {
  it("returns empty for zero-amplitude constituents", () => {
    const timeline = getTimeline(startDate, endDate);
    const constituents = [{ name: "M2", amplitude: 0, phase: 0 }];
    const prediction = predictionFactory({
      timeline,
      constituents,
      constituentModels: defaultConstituentModels,
      start: startDate,
    });
    expect(prediction.getExtremesPrediction()).toEqual([]);
  });

  it("returns empty when only Z0 offset is present", () => {
    // Z0 has speed=0, so maxSpeed=0 → no extremes
    const timeline = getTimeline(startDate, endDate);
    const constituents = [{ name: "Z0", amplitude: 1.5, phase: 0 }];
    const prediction = predictionFactory({
      timeline,
      constituents,
      constituentModels: defaultConstituentModels,
      start: startDate,
    });
    expect(prediction.getExtremesPrediction()).toEqual([]);
  });

  it("produces identical results regardless of timeFidelity", () => {
    const results10min = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction({ timeFidelity: 600 })
      .getExtremesPrediction();

    const results1min = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction({ timeFidelity: 60 })
      .getExtremesPrediction();

    expect(results10min.length).toBe(results1min.length);
    results10min.forEach((extreme, i) => {
      expect(extreme.time.getTime()).toBe(results1min[i].time.getTime());
      expect(extreme.level).toBe(results1min[i].level);
      expect(extreme.high).toBe(results1min[i].high);
    });
  });
});

describe("Secondary stations", () => {
  const regularResults = harmonics({
    harmonicConstituents: mockHarmonicConstituents,
    offset: false,
  })
    .setTimeSpan(startDate, extremesEndDate)
    .prediction()
    .getExtremesPrediction();

  it("generates subordinate timeline with ratio offsets", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 1.1, low: 0.9 },
      time: { high: 30, low: 15 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    expect(subTimeline.length).toBe(refTimeline.length);
    // Every point should have a finite level
    for (const point of subTimeline) {
      expect(Number.isFinite(point.level)).toBe(true);
    }
  });

  it("generates subordinate timeline with fixed offsets", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "fixed", high: 0.5, low: -0.3 },
      time: { high: 10, low: -10 },
    };

    const subTimeline = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getTimelinePrediction({ offsets });

    expect(subTimeline.length).toBeGreaterThan(0);
    for (const point of subTimeline) {
      expect(Number.isFinite(point.level)).toBe(true);
    }
  });

  it("subordinate timeline with identity offsets matches reference", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 1, low: 1 },
      time: { high: 0, low: 0 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    // With identity offsets, subordinate should match reference
    // (less floating-point noise)
    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].time.getTime()).toBe(refTimeline[i].time.getTime());
      expect(subTimeline[i].level).toBeCloseTo(refTimeline[i].level, 10);
    }
  });

  it("subordinate timeline from a tide with no turn above the threshold matches reference", () => {
    const predictor = createTidePredictor([{ name: "M2", amplitude: 0.004, phase: 20 }]);
    const span = {
      start: new Date("2025-01-01T00:00:00Z"),
      end: new Date("2025-01-01T04:00:00Z"),
    };

    const refTimeline = predictor.getTimelinePrediction(span);
    const subTimeline = predictor.getTimelinePrediction({
      ...span,
      offsets: { height: { type: "ratio", high: 1, low: 1 } },
    });

    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].level).toBeCloseTo(refTimeline[i].level, 10);
    }
  });

  it("it can add ratio offsets to secondary stations", () => {
    const offsets: ExtremeOffsets = {
      height: {
        type: "ratio",
        high: 1.1,
        low: 1.2,
      },
      time: {
        high: 1,
        low: 2,
      },
    };

    const offsetResults = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction({ offsets });

    offsetResults.forEach((offsetResult, index) => {
      if (offsetResult.low) {
        expect(offsetResult.level).toBeCloseTo(
          regularResults[index].level * offsets.height!.low!,
          4,
        );
        expect(offsetResult.time.getTime()).toBe(
          regularResults[index].time.getTime() + offsets.time!.low! * 60 * 1000,
        );
      }
      if (offsetResult.high) {
        expect(offsetResult.level).toBeCloseTo(
          regularResults[index].level * offsets.height!.high!,
          4,
        );

        expect(offsetResult.time.getTime()).toBe(
          regularResults[index].time.getTime() + offsets.time!.high! * 60 * 1000,
        );
      }
    });
  });

  it("uniform ratio with zero time offsets scales every point equally", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 2, low: 2 },
      time: { high: 0, low: 0 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].time.getTime()).toBe(refTimeline[i].time.getTime());
      expect(subTimeline[i].level).toBeCloseTo(refTimeline[i].level * 2, 5);
    }
  });

  it("uniform fixed offset with zero time offsets shifts every point equally", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "fixed", high: 0.5, low: 0.5 },
      time: { high: 0, low: 0 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].time.getTime()).toBe(refTimeline[i].time.getTime());
      expect(subTimeline[i].level).toBeCloseTo(refTimeline[i].level + 0.5, 5);
    }
  });

  it("non-uniform ratio with zero time offsets adjusts extremes correctly", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 1.5, low: 0.8 },
      time: { high: 0, low: 0 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    const refExtremes = prediction.getExtremesPrediction();
    const subExtremes = prediction.getExtremesPrediction({ offsets });

    // Timestamps should match since time offsets are zero
    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].time.getTime()).toBe(refTimeline[i].time.getTime());
    }

    // Extremes should be scaled by the correct per-type ratio
    for (let i = 0; i < refExtremes.length; i++) {
      const ratio = refExtremes[i].high ? 1.5 : 0.8;
      expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level * ratio, 4);
    }

    // All subordinate levels should remain finite
    for (const point of subTimeline) {
      expect(Number.isFinite(point.level)).toBe(true);
    }
  });

  it("non-uniform fixed offset with zero time offsets adjusts extremes correctly", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "fixed", high: 0.3, low: -0.2 },
      time: { high: 0, low: 0 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction();

    const refTimeline = prediction.getTimelinePrediction();
    const subTimeline = prediction.getTimelinePrediction({ offsets });

    const refExtremes = prediction.getExtremesPrediction();
    const subExtremes = prediction.getExtremesPrediction({ offsets });

    // Timestamps should match since time offsets are zero
    expect(subTimeline.length).toBe(refTimeline.length);
    for (let i = 0; i < refTimeline.length; i++) {
      expect(subTimeline[i].time.getTime()).toBe(refTimeline[i].time.getTime());
    }

    // Extremes should be shifted by the correct per-type offset
    for (let i = 0; i < refExtremes.length; i++) {
      const adj = refExtremes[i].high ? 0.3 : -0.2;
      expect(subExtremes[i].level).toBeCloseTo(refExtremes[i].level + adj, 4);
    }

    // All subordinate levels should remain finite
    for (const point of subTimeline) {
      expect(Number.isFinite(point.level)).toBe(true);
    }
  });

  it("subordinate timeline passes through its own extremes", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 1.1, low: 0.9 },
      time: { high: 30, low: 15 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction({ timeFidelity: 60 });

    const subTimeline = prediction.getTimelinePrediction({ offsets });
    const subExtremes = prediction.getExtremesPrediction({ offsets });

    for (const extreme of subExtremes) {
      // Find the two timeline points that bracket this extreme
      const eMs = extreme.time.getTime();
      let before = subTimeline[0];
      let after = subTimeline[1];
      for (let i = 1; i < subTimeline.length; i++) {
        if (subTimeline[i].time.getTime() >= eMs) {
          before = subTimeline[i - 1];
          after = subTimeline[i];
          break;
        }
      }

      // Linearly interpolate the timeline at the extreme's exact time
      const bMs = before.time.getTime();
      const aMs = after.time.getTime();
      const frac = aMs > bMs ? (eMs - bMs) / (aMs - bMs) : 0;
      const interpolatedLevel = before.level + frac * (after.level - before.level);

      expect(interpolatedLevel).toBeCloseTo(extreme.level, 4);

      // The extreme should actually be a local extremum on the timeline:
      // a high should be >= its neighbors, a low should be <= its neighbors
      if (extreme.high) {
        expect(interpolatedLevel).toBeGreaterThanOrEqual(before.level - 0.01);
        expect(interpolatedLevel).toBeGreaterThanOrEqual(after.level - 0.01);
      } else {
        expect(interpolatedLevel).toBeLessThanOrEqual(before.level + 0.01);
        expect(interpolatedLevel).toBeLessThanOrEqual(after.level + 0.01);
      }
    }
  });

  it("subordinate timeline is monotonic between extremes", () => {
    const offsets: ExtremeOffsets = {
      height: { type: "ratio", high: 1.1, low: 0.9 },
      time: { high: 30, low: 15 },
    };

    const prediction = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction({ timeFidelity: 60 });

    const subTimeline = prediction.getTimelinePrediction({ offsets });
    const subExtremes = prediction.getExtremesPrediction({ offsets });

    // Check monotonicity between each pair of consecutive extremes
    for (let e = 0; e < subExtremes.length - 1; e++) {
      const from = subExtremes[e];
      const to = subExtremes[e + 1];
      const rising = to.high; // rising if next extreme is a high

      // Get timeline points between these two extremes
      const fromMs = from.time.getTime();
      const toMs = to.time.getTime();
      const segment = subTimeline.filter((p) => {
        const t = p.time.getTime();
        return t >= fromMs && t <= toMs;
      });

      for (let i = 1; i < segment.length; i++) {
        if (rising) {
          expect(segment[i].level).toBeGreaterThanOrEqual(segment[i - 1].level - 0.001);
        } else {
          expect(segment[i].level).toBeLessThanOrEqual(segment[i - 1].level + 0.001);
        }
      }
    }
  });

  it("it can add fixed offsets to secondary stations", () => {
    const offsets: ExtremeOffsets = {
      height: {
        type: "fixed",
        high: 1.1,
        low: 1.2,
      },
      time: {
        high: 1,
        low: 2,
      },
    };

    const offsetResults = harmonics({
      harmonicConstituents: mockHarmonicConstituents,
      offset: false,
    })
      .setTimeSpan(startDate, extremesEndDate)
      .prediction()
      .getExtremesPrediction({ offsets });

    offsetResults.forEach((offsetResult, index) => {
      if (offsetResult.low) {
        expect(offsetResult.level).toBeCloseTo(
          regularResults[index].level + offsets.height!.low!,
          4,
        );
        expect(offsetResult.time.getTime()).toBe(
          regularResults[index].time.getTime() + offsets.time!.low! * 60 * 1000,
        );
      }
      if (offsetResult.high) {
        expect(offsetResult.level).toBeCloseTo(
          regularResults[index].level + offsets.height!.high!,
          4,
        );

        expect(offsetResult.time.getTime()).toBe(
          regularResults[index].time.getTime() + offsets.time!.high! * 60 * 1000,
        );
      }
    });
  });
});
