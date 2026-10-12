import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  residuals,
  filterResiduals,
  residualTrend,
  type ResidualSample,
  type ResidualTrend,
  type WaterLevelReading,
} from "../src/index.js";

const hour = 3600000;
const hourly = (n: number, value: (i: number) => number, offset = 0): ResidualSample[] =>
  Array.from({ length: n }, (_, i) => ({ time: new Date(offset + i * hour), value: value(i) }));

interface Fixture {
  cases: {
    name: string;
    samples: { time: number; value: number }[];
    readings?: { time: number; observed: number; predicted: number }[];
    filtered: { time: number; value: number }[];
    trend: { time: number; slopePerHour: number; direction: ResidualTrend["direction"] } | null;
  }[];
}
const fixture: Fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/residuals-parity.json", import.meta.url), "utf8"),
);

describe("residual math public API", () => {
  test("subtracts paired levels without changing the readings", () => {
    const input: readonly WaterLevelReading[] = Object.freeze([
      Object.freeze({ time: new Date(0), observed: 1.4, predicted: 1.2 }),
      Object.freeze({ time: new Date(1), observed: 0, predicted: 0 }),
      Object.freeze({ time: new Date(2), observed: -2, predicted: 1 }),
    ]);
    const before = structuredClone(input);
    expect(residuals(input)[0].value).toBeCloseTo(0.2, 12);
    expect(
      residuals(input)
        .slice(1)
        .map((s) => s.value),
    ).toEqual([0, -3]);
    expect(input).toEqual(before);
    expect(residuals([])).toEqual([]);
  });

  test("requires 71 samples and centers the result 35 hours before the newest input", () => {
    expect(filterResiduals([])).toEqual([]);
    expect(filterResiduals(hourly(70, () => 0.15))).toEqual([]);
    expect(filterResiduals(hourly(71, () => 0.15))).toEqual([
      { time: new Date(35 * hour), value: expect.closeTo(0.15, 12) },
    ]);
    const input = hourly(97, (i) => 0.1 + i * 0.002);
    const before = structuredClone(input);
    const filtered = filterResiduals(input);
    expect(filtered).toHaveLength(27);
    expect(filtered.at(-1)!.time.getTime()).toBe(61 * hour);
    expect(residualTrend(filtered)?.slopePerHour).toBeCloseTo(0.002, 12);
    expect(residualTrend(filtered)?.direction).toBe("rising");
    expect(input).toEqual(before);
  });

  test.each(fixture.cases)("matches independent oracle: $name", (entry) => {
    const samples = entry.samples.map((s) => ({ ...s, time: new Date(s.time) }));
    if (entry.readings) {
      const actual = residuals(entry.readings.map((r) => ({ ...r, time: new Date(r.time) })));
      actual.forEach((s, i) => {
        expect(s.time.getTime()).toBe(entry.samples[i].time);
        expect(Math.abs(s.value - entry.samples[i].value)).toBeLessThan(1e-9);
      });
    }
    const actual = filterResiduals(samples);
    expect(actual).toHaveLength(entry.filtered.length);
    actual.forEach((s, i) => {
      expect(s.time.getTime()).toBe(entry.filtered[i].time);
      expect(Math.abs(s.value - entry.filtered[i].value)).toBeLessThan(1e-9);
    });
    const trend = residualTrend(actual);
    if (entry.trend) {
      expect(trend!.time.getTime()).toBe(entry.trend.time);
      expect(Math.abs(trend!.slopePerHour - entry.trend.slopePerHour)).toBeLessThan(1e-10);
      expect(trend!.direction).toBe(entry.trend.direction);
    } else {
      expect(trend).toBeUndefined();
    }
  });

  test.each([1800000, 123, Date.parse("2025-11-02T00:30:00-07:00")])(
    "retains an arbitrary hourly grid across DST: %s",
    (offset) => {
      const result = filterResiduals(hourly(97, () => 1, offset));
      expect(result[0].time.getTime()).toBe(offset + 35 * hour);
      expect(result.at(-1)!.time.getTime()).toBe(offset + 61 * hour);
      expect(residualTrend(result)?.time.getTime()).toBe(offset + 61 * hour);
    },
  );

  test("filters only windows supported on either side of a missing hour", () => {
    const result = filterResiduals(hourly(145, () => 1).filter((_, i) => i !== 72));
    expect(result.map((s) => s.time.getTime())).toEqual([35, 36, 108, 109].map((i) => i * hour));
    expect(filterResiduals(hourly(97, () => 1).filter((_, i) => i !== 95))).toHaveLength(25);
  });

  test("requires the newest 25 consecutive samples, never an older window", () => {
    expect(residualTrend([])).toBeUndefined();
    expect(residualTrend(hourly(24, () => 0))).toBeUndefined();
    expect(residualTrend(hourly(26, () => 0).filter((_, i) => i !== 24))).toBeUndefined();
    expect(residualTrend(hourly(50, (i) => i * -0.002).filter((_, i) => i !== 24))?.direction).toBe(
      "falling",
    );
  });

  test.each([
    [0, "steady"],
    [0.002, "rising"],
    [-0.002, "falling"],
    [0.01 / 24, "steady"],
    [-0.01 / 24, "steady"],
    [(0.01 + 0.5e-12) / 24, "steady"],
    [-(0.01 + 0.5e-12) / 24, "steady"],
    [(0.01 + 2e-12) / 24, "rising"],
    [-(0.01 + 2e-12) / 24, "falling"],
  ] as const)("classifies slope %s as %s", (slope, direction) => {
    const result = residualTrend(hourly(25, (i) => i * slope))!;
    expect(result.slopePerHour).toBeCloseTo(slope, 12);
    expect(result.direction).toBe(direction);
  });

  test("centers regression to preserve a small slope on a large offset", () => {
    const input = hourly(25, (i) => 1e6 + i * 0.002);
    const before = structuredClone(input);
    expect(Math.abs(residualTrend(input)!.slopePerHour - 0.002)).toBeLessThan(1e-10);
    expect(input).toEqual(before);
  });
});

describe("strict input and arithmetic validation", () => {
  test.each([NaN, Infinity, -Infinity])("rejects non-finite input %s", (invalid) => {
    for (const field of ["observed", "predicted"] as const) {
      expect(() =>
        residuals([{ time: new Date(0), observed: 0, predicted: 0, [field]: invalid }]),
      ).toThrow(new RangeError("invalidSamples"));
    }
    expect(() => residuals([{ time: new Date(invalid), observed: 0, predicted: 0 }])).toThrow(
      new RangeError("invalidSamples"),
    );
    for (const operation of [filterResiduals, residualTrend]) {
      expect(() => operation([{ time: new Date(0), value: invalid }])).toThrow(
        new RangeError("invalidSamples"),
      );
      expect(() => operation([{ time: new Date(invalid), value: 0 }])).toThrow(
        new RangeError("invalidSamples"),
      );
    }
  });

  test.each([0, -hour])("rejects duplicate or descending timestamps: %s", (second) => {
    expect(() =>
      residuals([0, second].map((t) => ({ time: new Date(t), observed: 0, predicted: 0 }))),
    ).toThrow(new RangeError("invalidSamples"));
    for (const operation of [filterResiduals, residualTrend]) {
      expect(() => operation([0, second].map((t) => ({ time: new Date(t), value: 0 })))).toThrow(
        new RangeError("invalidSamples"),
      );
    }
  });

  test.each([hour / 10, hour + 1, 2 * hour + 1])("rejects off-grid cadence: %s", (second) => {
    for (const operation of [filterResiduals, residualTrend]) {
      expect(() =>
        operation([
          { time: new Date(123), value: 0 },
          { time: new Date(123 + second), value: 0 },
        ]),
      ).toThrow(new RangeError("invalidCadence"));
    }
  });

  test("rejects subtraction, filtering, and regression overflow", () => {
    expect(() =>
      residuals([{ time: new Date(0), observed: Number.MAX_VALUE, predicted: -Number.MAX_VALUE }]),
    ).toThrow(new RangeError("nonFiniteResult"));
    expect(() => filterResiduals(hourly(71, () => Number.MAX_VALUE))).toThrow(
      new RangeError("nonFiniteResult"),
    );
    expect(() =>
      residualTrend(hourly(25, (i) => (i < 12 ? -Number.MAX_VALUE : Number.MAX_VALUE))),
    ).toThrow(new RangeError("nonFiniteResult"));
  });
});
