import { describe, it, expect } from "vitest";
import {
  constituents,
  createCurrentPredictor,
  createTidePredictor,
  defineConstituents,
  fit,
  type ConstituentDefinition,
} from "../../src/index.js";

const M2 = constituents.M2;
const asDefinition = (name: string): ConstituentDefinition => ({
  name,
  speed: M2.speed,
  coefficients: M2.coefficients,
  members: [["M2", 1]],
});
const span = { start: new Date("2026-01-01"), end: new Date("2026-01-03"), timeFidelity: 3600 };
const levels = (c: { name: string; amplitude: number; phase: number }[], opts = {}) =>
  createTidePredictor(c, opts)
    .getTimelinePrediction(span)
    .map((p) => p.level);

describe("defineConstituents", () => {
  it("resolves members against later definitions and the base", () => {
    const models = defineConstituents(
      [
        { name: "A", speed: 1, coefficients: null, members: [["B", 2]] },
        { name: "B", speed: 0.5, coefficients: null, aliases: ["b"], members: [["M2", 1]] },
      ],
      constituents,
    );
    expect(models.A.members).toEqual([{ constituent: models.B, factor: 2 }]);
    expect(models.b).toBe(models.B);
    expect(models.B.members).toEqual([{ constituent: M2, factor: 1 }]);
    expect(models.M2).toBe(M2);
  });

  it("rejects a member it can't resolve", () => {
    expect(() =>
      defineConstituents([{ name: "A", speed: 1, coefficients: null, members: [["M2", 1]] }]),
    ).toThrow("unknownConstituent: M2 (member of A)");
    expect(() =>
      defineConstituents([{ name: "A", speed: 1, coefficients: null, members: [["toString", 1]] }]),
    ).toThrow(RangeError);
  });

  it("leaves the catalog alone", () => {
    defineConstituents([asDefinition("M2")], constituents);
    expect(constituents.M2).toBe(M2);
  });
});

describe("definitions option", () => {
  const station = [{ name: "M2_COPY", amplitude: 1, phase: 30 }];

  it("predicts a constituent the catalog doesn't have", () => {
    expect(levels(station).every((l) => l === 0)).toBe(true);
    expect(levels(station, { definitions: [asDefinition("M2_COPY")] })).toEqual(
      levels([{ name: "M2", amplitude: 1, phase: 30 }]),
    );
  });

  it("replaces a catalog entry without moving catalog compounds", () => {
    // One more 90° in the argument is the same line at a phase 90° earlier.
    const [d1, d2, d3, d4, d5, d6, d7] = M2.coefficients!;
    const definitions: ConstituentDefinition[] = [
      { ...asDefinition("M2"), coefficients: [d1, d2, d3, d4, d5, d6, d7 + 1] },
    ];
    const expected = levels([{ name: "M2", amplitude: 1, phase: -60 }]);
    levels([{ name: "M2", amplitude: 1, phase: 30 }], { definitions }).forEach((l, i) =>
      expect(l).toBeCloseTo(expected[i], 12),
    );
    const ms4 = [{ name: "MS4", amplitude: 1, phase: 0 }];
    expect(levels(ms4, { definitions })).toEqual(levels(ms4));
  });

  it("predicts currents from definitions", () => {
    const opts = { floodDirection: 0, ebbDirection: 180 };
    const speeds = (c: typeof station, o = {}) =>
      createCurrentPredictor(c, { ...opts, ...o })
        .getTimelinePrediction(span)
        .map((p) => p.speed);
    expect(speeds(station, { definitions: [asDefinition("M2_COPY")] })).toEqual(
      speeds([{ name: "M2", amplitude: 1, phase: 30 }]),
    );
  });

  it("fits a constituent the catalog doesn't have", () => {
    const predictor = createTidePredictor([{ name: "M2", amplitude: 1.2, phase: 75 }]);
    const samples = Array.from({ length: 48 }, (_, h) => {
      const time = new Date(Date.UTC(2026, 0, 1, h));
      return { time, value: predictor.getWaterLevelAtTime({ time }).level };
    });
    expect(() => fit(samples, ["M2_COPY"])).toThrow("unknownConstituent: M2_COPY");
    const [result] = fit(samples, ["M2_COPY"], {
      definitions: [asDefinition("M2_COPY")],
    }).constituents;
    expect(result.amplitude).toBeCloseTo(1.2, 9);
    expect(result.phase).toBeCloseTo(75, 9);
  });
});
