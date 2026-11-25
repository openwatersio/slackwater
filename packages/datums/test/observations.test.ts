import { describe, expect, test } from "vitest";
import { createTidePredictor } from "@slackwater/engine";
import {
  prepareDatumObservations,
  observedMeanLevel,
} from "../observations.ts";
import type { Sample } from "../datum.ts";

const constituents = [
  { name: "M2", amplitude: 1, phase: 15 },
  { name: "S2", amplitude: 0.3, phase: 35 },
  { name: "K1", amplitude: 0.4, phase: 0 },
];
const start = Date.UTC(2020, 0, 1);
const end = Date.UTC(2022, 0, 2);
const predictor = createTidePredictor(constituents);
const truth: Sample[] = Array.from(
  { length: (end - start) / 3600000 },
  (_, h) => {
    const time = new Date(start + h * 3600000);
    return { time, level: 5 + predictor.getWaterLevelAtTime({ time }).level };
  },
);

describe("datum observation preparation", () => {
  test.each([1, 2, 3])(
    "fits a degree-%i residual when sample phases and profiles change across a gap",
    (degree) => {
      const cs = [{ name: "S2", amplitude: 2, phase: 15 }];
      const model = createTidePredictor(cs);
      const raw: Sample[] = [];
      const gap = 24 * 100;
      const before = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54];
      const after = [54];
      const height = (h: number, minute: number) => {
        const time = new Date(start + h * 3600000 + minute * 60000);
        const x = h - gap + minute / 60;
        const residual = Math.abs(x) < 8 ? 0.1 * x ** degree : 0;
        return {
          time,
          level: 5 + model.getWaterLevelAtTime({ time }).level + residual,
        };
      };
      for (let h = 0; h < 8784; h++) {
        if (h >= gap && h < gap + 3) continue;
        for (const minute of h < gap ? before : after)
          raw.push(height(h, minute));
      }
      const result = prepareDatumObservations(raw, cs)!;
      for (let h = gap; h < gap + 3; h++) {
        const profile = h < gap + 2 ? before : after;
        const expected =
          profile.reduce((sum, minute) => sum + height(h, minute).level, 0) /
          profile.length;
        expect(
          result.samples.find((p) => +p.time === start + h * 3600000)!.level,
        ).toBeCloseTo(expected, 9);
      }
    },
  );
  test("trims seasonal tails to the latest whole-year window", () => {
    const partial = truth.filter((p) => +p.time < Date.UTC(2021, 5, 1));
    const result = prepareDatumObservations(partial, constituents)!;
    expect(result.coverage.months).toBe(12);
    expect(result.start.toISOString()).toBe("2020-06-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2021-05-31T23:00:00.000Z");
  });

  test("compares six-minute bin means with mean predictions when filling missing hours", () => {
    const cs = [{ name: "S2", amplitude: 2, phase: 15 }];
    const model = createTidePredictor(cs);
    const raw: Sample[] = [],
      expected: number[] = [];
    for (let h = 0; h < 8784; h++) {
      let sum = 0;
      for (let minute = 0; minute < 60; minute += 6) {
        const time = new Date(start + h * 3600000 + minute * 60000);
        const level = 5 + model.getWaterLevelAtTime({ time }).level;
        raw.push({ time, level });
        sum += level;
      }
      expected.push(sum / 10);
    }
    const masked = raw.filter((p) => {
      const h = Math.floor((+p.time - start) / 3600000);
      return h % 120 < 24 || h % 120 >= 27;
    });
    const result = prepareDatumObservations(masked, cs)!;
    for (const p of result.samples)
      expect(p.level).toBeCloseTo(expected[(+p.time - start) / 3600000]!, 9);
  });
  test("reconstructs short gaps at the larger tides without selecting only smaller tides", () => {
    const masked = truth.filter(
      (p, i) =>
        !(
          i > 0 &&
          i + 1 < truth.length &&
          p.level > 6.15 &&
          p.level > truth[i - 1]!.level &&
          p.level >= truth[i + 1]!.level
        ),
    );
    const result = prepareDatumObservations(masked, constituents)!;
    expect(result).not.toBeNull();
    expect(result.coverage.inferredHours).toBeGreaterThan(100);
    const expected = new Map(truth.map((p) => [+p.time, p.level]));
    for (const p of result.samples)
      expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test.each([1, 2, 3])(
    "reconstructs a bounded %i-hour omission from real surrounding anchors",
    (missing) => {
      const masked = truth.filter(
        (_, h) => h % 120 < 24 || h % 120 >= 24 + missing,
      );
      const result = prepareDatumObservations(masked, constituents)!;
      expect(result).not.toBeNull();
      const expected = new Map(truth.map((p) => [+p.time, p.level]));
      for (const p of result.samples)
        expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
    },
  );

  test("retains both sides of a three-hour to hourly cadence change", () => {
    const change = Date.UTC(2021, 0, 1);
    const sampled = truth.filter((p, h) => +p.time >= change || h % 3 === 0);
    const context = new Date(start - 3 * 3600000);
    sampled.unshift({
      time: context,
      level: 5 + predictor.getWaterLevelAtTime({ time: context }).level,
    });
    const result = prepareDatumObservations(sampled, constituents)!;
    expect(result.start.getUTCFullYear()).toBe(2020);
    expect(result.end.getUTCFullYear()).toBe(2021);
    const expected = new Map(truth.map((p) => [+p.time, p.level]));
    for (const p of result.samples)
      expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test("carries a changing observed residual through the gap instead of substituting the tide model", () => {
    const drifting = truth.map((p, h) => ({
      ...p,
      level: p.level + 0.2 * (h / 8760) ** 3,
    }));
    const masked = drifting.filter((_, h) => h % 120 < 24 || h % 120 >= 27);
    const result = prepareDatumObservations(masked, constituents)!;
    const expected = new Map(drifting.map((p) => [+p.time, p.level]));
    for (const p of result.samples)
      expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test("does not chain inferred points across a longer omission", () => {
    const masked = truth.filter((_, h) => h % 120 < 24 || h % 120 >= 31);
    expect(prepareDatumObservations(masked, constituents)).toBeNull();
  });

  test("does not bridge long gaps or stitch separate partial seasons into an epoch", () => {
    const fragments = truth.filter((_, h) => h % (24 * 90) < 24 * 45);
    expect(prepareDatumObservations(fragments, constituents)).toBeNull();
  });

  test("does not infer missing extrema without a tide model", () => {
    const masked = truth.filter((_, h) => h % 48 !== 3);
    expect(prepareDatumObservations(masked, [])).toBeNull();
  });

  test("keeps a whole non-leap calendar year and excludes partial months", () => {
    const year = truth.filter(
      (p) =>
        p.time >= new Date("2021-01-01T00:00:00Z") &&
        p.time < new Date("2022-01-01T00:00:00Z"),
    );
    const result = prepareDatumObservations(year, [])!;
    expect(result.start.toISOString()).toBe("2021-01-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2021-12-31T23:00:00.000Z");
    expect(result.coverage.months).toBe(12);
    expect(result.samples).toHaveLength(8760);
  });

  test("chooses the later of equally long continuous periods", () => {
    const samples = Array.from(
      { length: (Date.UTC(2024, 0, 1) - start) / 3600000 },
      (_, h) => ({ time: new Date(start + h * 3600000), level: 5 }),
    ).filter((p) => [2020, 2022].includes(p.time.getUTCFullYear()));
    const result = prepareDatumObservations(samples, [])!;
    expect(result.coverage.months).toBe(12);
    expect(result.start.toISOString()).toBe("2022-01-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2022-12-31T23:00:00.000Z");
  });

  test("rejects five-hour anchor separation rather than inventing its missing tides", () => {
    const masked = truth.filter((_, h) => h % 24 < 7 || h % 24 > 10);
    expect(prepareDatumObservations(masked, constituents)).toBeNull();
  });

  test("ignores invalid observations instead of poisoning the window", () => {
    const result = prepareDatumObservations(
      [
        ...truth,
        { time: new Date(NaN), level: 1 },
        { time: new Date(start), level: NaN },
      ],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.samples.every((p) => Number.isFinite(p.level))).toBe(true);
  });

  test("rejects a sparse raw gauge mean without all twelve calendar-month categories", () => {
    const samples = truth
      .map((p, h) => ({ ...p, level: h % 2 ? 6 : 8 }))
      .filter((_, h) => h % (24 * 90) < 24 * 45);
    expect(observedMeanLevel(samples, constituents)).toBeUndefined();
    expect(prepareDatumObservations(samples, constituents)).toBeNull();
    expect(observedMeanLevel([])).toBeUndefined();
  });
  test("balances complete months across all seasons for a non-continuous fallback offset", () => {
    const samples = truth
      .map((p, h) => ({ ...p, level: h % 2 ? 6 : 8 }))
      .filter(
        (p) =>
          !(p.time.getUTCFullYear() === 2020 && p.time.getUTCMonth() === 6) &&
          !(p.time.getUTCFullYear() === 2021 && p.time.getUTCMonth() === 1),
      );
    expect(prepareDatumObservations(samples, [])).toBeNull();
    expect(observedMeanLevel(samples, [])).toBe(7);
  });
  test("refuses an offset when every year omits the same season", () => {
    const summer = truth.filter(
      (p) => p.time.getUTCMonth() >= 3 && p.time.getUTCMonth() <= 8,
    );
    expect(observedMeanLevel(summer, constituents)).toBeUndefined();
  });
});
