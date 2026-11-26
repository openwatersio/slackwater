import { describe, expect, test } from "vitest";
import { createTidePredictor } from "@slackwater/engine";
import {
  computeDatumsFromObservations,
  prepareDatumObservations,
  observedMeanLevel,
  type Sample,
} from "../src/index.js";

const constituents = [
  { name: "M2", amplitude: 1, phase: 15 },
  { name: "S2", amplitude: 0.3, phase: 35 },
  { name: "K1", amplitude: 0.4, phase: 0 },
];
const start = Date.UTC(2020, 0, 1);
const end = Date.UTC(2022, 0, 2);
const predictor = createTidePredictor(constituents);
const truth: Sample[] = Array.from({ length: (end - start) / 3600000 }, (_, h) => {
  const time = new Date(start + h * 3600000);
  return { time, level: 5 + predictor.getWaterLevelAtTime({ time }).level };
});

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
        for (const minute of h < gap ? before : after) raw.push(height(h, minute));
      }
      const result = prepareDatumObservations(raw, cs)!;
      for (let h = gap; h < gap + 3; h++) {
        const profile = h < gap + 2 ? before : after;
        const expected =
          profile.reduce((sum, minute) => sum + height(h, minute).level, 0) / profile.length;
        expect(result.samples.find((p) => +p.time === start + h * 3600000)!.level).toBeCloseTo(
          expected,
          9,
        );
      }
    },
  );
  test("trims seasonal tails to the latest whole-year window", () => {
    const partial = truth.filter((p) => +p.time < Date.UTC(2021, 5, 1));
    const result = prepareDatumObservations(partial, constituents)!;
    expect(result.coverage.months).toBe(12);
    expect(result.start.toISOString()).toBe("2020-06-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2021-06-01T00:00:00.000Z");
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
  }, 15_000);
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
    for (const p of result.samples) expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test.each([1, 2, 3])(
    "reconstructs a bounded %i-hour omission from real surrounding anchors",
    (missing) => {
      const masked = truth.filter((_, h) => h % 120 < 24 || h % 120 >= 24 + missing);
      const result = prepareDatumObservations(masked, constituents)!;
      expect(result).not.toBeNull();
      const expected = new Map(truth.map((p) => [+p.time, p.level]));
      for (const p of result.samples) expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
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
    expect(result.end.toISOString()).toBe("2022-01-01T00:00:00.000Z");
    const expected = new Map(truth.map((p) => [+p.time, p.level]));
    for (const p of result.samples) expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test("carries a changing observed residual through the gap instead of substituting the tide model", () => {
    const drifting = truth.map((p, h) => ({
      ...p,
      level: p.level + 0.2 * (h / 8760) ** 3,
    }));
    const masked = drifting.filter((_, h) => h % 120 < 24 || h % 120 >= 27);
    const result = prepareDatumObservations(masked, constituents)!;
    const expected = new Map(drifting.map((p) => [+p.time, p.level]));
    for (const p of result.samples) expect(p.level).toBeCloseTo(expected.get(+p.time)!, 9);
  });

  test("fills a seven-hour omission from the prediction and observed residual", () => {
    const drifting = truth.map((p, h) => ({ ...p, level: p.level + 0.1 * Math.sin(h / 500) }));
    const masked = drifting.filter((_, h) => h % 120 < 24 || h % 120 >= 31);
    const result = prepareDatumObservations(masked, constituents)!;
    expect(result.coverage.months).toBe(24);
    const observed = new Set(masked.map((p) => +p.time));
    expect(result.coverage.inferredHours).toBe(
      result.samples.filter((p) => !observed.has(+p.time)).length,
    );
    expect(result.coverage.inferredHours).toBeGreaterThan(1000);
    const expected = new Map(drifting.map((p) => [+p.time, p.level]));
    for (const p of result.samples) expect(p.level).toBeCloseTo(expected.get(+p.time)!, 3);
  });

  test("gives the gapless record's datums with seven hours missing every five days", () => {
    const masked = truth.filter((_, h) => h % 120 < 24 || h % 120 >= 31);
    const filled = computeDatumsFromObservations(masked, constituents)!;
    const full = computeDatumsFromObservations(truth, constituents)!;
    expect(filled.coverage.inferredHours).toBeGreaterThan(1000);
    for (const [name, level] of Object.entries(full.datums))
      expect(filled.datums[name]).toBeCloseTo(level!, 2);
  });

  const stepped = (step: number) =>
    truth
      .map((p) => ({ ...p, level: p.level + (p.time >= new Date("2021-06-10T07:00Z") ? step : 0) }))
      .filter(
        (p) => p.time < new Date("2021-06-10T00:00Z") || p.time >= new Date("2021-06-10T07:00Z"),
      );

  test("does not bridge a gauge zero shift hidden in a seven-hour omission", () => {
    const result = prepareDatumObservations(stepped(0.5), constituents)!;
    expect(result.coverage.months).toBe(12);
    expect(result.start.toISOString()).toBe("2020-06-01T00:00:00.000Z");
    expect(result.coverage.inferredHours).toBe(0);
  });

  test.each([
    [0.09, 24],
    [0.11, 12],
  ])(
    "fills a seven-hour omission across a %f m level change only within the limit",
    (step, months) => {
      expect(prepareDatumObservations(stepped(step), constituents)!.coverage.months).toBe(months);
    },
  );

  test("does not count curve-fitted hours against the monthly fill limit", () => {
    // Three missing hours a day is 93 hours a month, all bridged by the cubic.
    const masked = truth.filter((_, h) => h % 24 < 10 || h % 24 >= 13);
    expect(prepareDatumObservations(masked, constituents)!.coverage.months).toBe(24);
  });

  test("does not chain fills across a lone real hour", () => {
    // Two 23-hour gaps around one real hour make a 47-hour outage every 30 days.
    const lone = truth.filter((_, h) => h % 720 < 24 || h % 720 === 47 || h % 720 >= 71);
    expect(prepareDatumObservations(lone, constituents)).toBeNull();
    // With two real hours on each side, each 23-hour gap fills on its own.
    const pair = truth.filter(
      (_, h) => h % 720 < 24 || h % 720 === 47 || h % 720 === 48 || h % 720 >= 72,
    );
    expect(prepareDatumObservations(pair, constituents)!.coverage.months).toBe(24);
  });

  test("does not fill an omission of a day or more", () => {
    const day = truth.filter((_, h) => h % 2000 < 24 || h % 2000 >= 48);
    expect(prepareDatumObservations(day, constituents)).toBeNull();
    const underDay = truth.filter((_, h) => h % 2000 < 24 || h % 2000 >= 47);
    expect(prepareDatumObservations(underDay, constituents)!.coverage.months).toBe(24);
  });

  test.each([
    [72, 24],
    [73, 12],
  ])("counts a month with %i prediction-filled hours toward %i months", (hours, months) => {
    // In March 2021: gaps of 23, 23, and 22 or 23 hours, plus one of 4 too long for the cubic.
    const missing = (t: Date) => {
      const day = t.getUTCDate(),
        hour = t.getUTCHours();
      return (
        (day === 3 && hour < 23) ||
        (day === 10 && hour < 23) ||
        (day === 17 && hour < hours - 50) ||
        (day === 25 && hour >= 10 && hour < 14)
      );
    };
    const masked = truth.filter(
      (p) => !(p.time.getUTCFullYear() === 2021 && p.time.getUTCMonth() === 2 && missing(p.time)),
    );
    expect(prepareDatumObservations(masked, constituents)!.coverage.months).toBe(months);
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
        p.time >= new Date("2021-01-01T00:00:00Z") && p.time < new Date("2022-01-01T00:00:00Z"),
    );
    const result = prepareDatumObservations(year, [])!;
    expect(result.start.toISOString()).toBe("2021-01-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2022-01-01T00:00:00.000Z");
    expect(result.coverage.months).toBe(12);
    expect(result.samples).toHaveLength(8760);
  });

  test("chooses the later of equally long continuous periods", () => {
    const samples = Array.from({ length: (Date.UTC(2024, 0, 1) - start) / 3600000 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: 5,
    })).filter((p) => [2020, 2022].includes(p.time.getUTCFullYear()));
    const result = prepareDatumObservations(samples, [])!;
    expect(result.coverage.months).toBe(12);
    expect(result.start.toISOString()).toBe("2022-01-01T00:00:00.000Z");
    expect(result.end.toISOString()).toBe("2023-01-01T00:00:00.000Z");
  });

  test("rejects four missing hours every day, over the monthly fill limit", () => {
    const masked = truth.filter((_, h) => h % 24 < 7 || h % 24 > 10);
    expect(prepareDatumObservations(masked, constituents)).toBeNull();
  });

  test("ignores invalid observations instead of poisoning the window", () => {
    const result = prepareDatumObservations(
      [...truth, { time: new Date(NaN), level: 1 }, { time: new Date(start), level: NaN }],
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
    const summer = truth.filter((p) => p.time.getUTCMonth() >= 3 && p.time.getUTCMonth() <= 8);
    expect(observedMeanLevel(summer, constituents)).toBeUndefined();
  });
});
