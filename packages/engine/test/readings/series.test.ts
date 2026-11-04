import { describe, test, expect } from "vitest";
import { bandCrossing, interpolate, peakRank } from "../../src/index.js";

const H = 3600 * 1000;
const t0 = Date.UTC(2026, 9, 10);
const s = (seconds: number, speed: number) => ({ time: new Date(t0 + seconds * 1000), speed });

describe("interpolate", () => {
  const points = [0, 2, 2, 6].map((v, i) => ({ time: new Date(t0 + Math.min(i, 2) * H), v }));

  test("linear between samples and undefined outside them", () => {
    expect(interpolate(points, new Date(t0 + 0.25 * H), (p) => p.v)).toBe(0.5);
    expect(interpolate(points, new Date(t0 - 1), (p) => p.v)).toBeUndefined();
    expect(interpolate(points, new Date(t0 + 3 * H), (p) => p.v)).toBeUndefined();
    expect(interpolate([], new Date(t0), (p: { time: Date }) => p.time.getTime())).toBeUndefined();
  });

  test("takes the first of two samples sharing an instant", () => {
    expect(interpolate(points, new Date(t0 + 2 * H), (p) => p.v)).toBe(2);
  });

  test("a single sample reads at its own instant and nowhere else", () => {
    const only = [{ time: new Date(t0), level: 2 }];
    expect(interpolate(only, new Date(t0), (p) => p.level)).toBe(2);
    expect(interpolate(only, new Date(t0 + 1), (p) => p.level)).toBeUndefined();
  });
});

describe("bandCrossing", () => {
  test("same-sign steps cross where the absolute speed meets the band", () => {
    // (0 s, 2 kn) → (600 s, 0 kn), threshold 0.5: at 450 s
    expect(bandCrossing(s(0, 2), s(600, 0), 0.5).getTime()).toBe(t0 + 450_000);
  });

  test("a signed band crossing across a reversal matches iOS", () => {
    // (0 s, −1 kn) → (600 s, +0.1 kn), threshold 0.15: 463.6 s, not the folded 566.7 s
    expect(bandCrossing(s(0, -1), s(600, 0.1), 0.15).getTime()).toBeCloseTo(t0 + 463_636.36, -1);
  });
});

describe("peakRank", () => {
  test("the fraction at or below the value, ties counting as below", () => {
    expect(peakRank(3, [1, 2, 3, 4])).toBe(0.75);
    expect(peakRank(2, [2, 2, 3, 4])).toBe(0.5);
    expect(peakRank(4, [1, 2, 3, 4])).toBe(1);
    expect(peakRank(1, [1, 2, 3, 4])).toBe(0.25);
  });

  test("nothing to rank against with fewer than two", () => {
    expect(peakRank(3, [3])).toBeUndefined();
    expect(peakRank(3, [])).toBeUndefined();
  });
});
