import { describe, it, expect } from "vitest";
import {
  astro,
  constituents,
  createCurrentPredictor,
  createTidePredictor,
  defineConstituents,
  fit,
  type ConstituentDefinition,
} from "../../src/index.js";

const M2 = constituents.M2;
// M2's line under another name, taking M2's nodal correction.
const asDefinition = (name: string): ConstituentDefinition => ({
  name,
  speed: M2.speed,
  coefficients: M2.coefficients,
  members: [["M2", 1]],
});
// M2's own definition; the node-correction formulas supply its correction.
const m2 = (coefficients = M2.coefficients): ConstituentDefinition => ({
  name: "M2",
  speed: M2.speed,
  coefficients,
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
        { name: "A", speed: 2 * M2.speed, coefficients: null, members: [["B", 2]] },
        {
          name: "B",
          speed: M2.speed,
          coefficients: null,
          aliases: ["B", "b"],
          members: [["M2", 1]],
        },
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
    defineConstituents([m2()], constituents);
    expect(constituents.M2).toBe(M2);
  });

  it("replaces a catalog entry under all its names", () => {
    const nu2 = { ...asDefinition("nu2"), aliases: ["NU2"] };
    const models = defineConstituents([nu2], constituents);
    expect(models.NU2).toBe(models.nu2);
    expect(models["ν2"]).toBe(models.nu2);
    expect(models.nu2).not.toBe(constituents.nu2);
    expect(defineConstituents([asDefinition("NU2")], constituents).nu2.name).toBe("NU2");
  });

  it("keeps a replaced entry's correction formula under its other names", () => {
    const mf = constituents.Mf;
    const definition = { name: "MF", speed: mf.speed, coefficients: mf.coefficients };
    const models = defineConstituents([definition], constituents);
    const state = astro(new Date("2026-01-01"));
    expect(models.Mf).toBe(models.MF);
    expect(models.MF.correction(state)).toEqual(mf.correction(state));
    expect(definition).not.toHaveProperty("aliases");
  });

  it("rejects a definition that names two catalog entries", () => {
    expect(() =>
      defineConstituents([{ ...asDefinition("X"), aliases: ["M2", "N2"] }], constituents),
    ).toThrow("invalidDefinition: X (names two constituents)");
  });

  it("rejects member cycles", () => {
    expect(() =>
      defineConstituents([{ name: "X", speed: 1, coefficients: null, members: [["X", 1]] }]),
    ).toThrow("cyclicConstituent: X");
    expect(() =>
      defineConstituents([
        { name: "A", speed: 1, coefficients: null, members: [["B", 1]] },
        { name: "B", speed: 1, coefficients: [0, 0, 1, 0, 0, 0, 0], members: [["A", 1]] },
      ]),
    ).toThrow("cyclicConstituent");
    expect(() => defineConstituents([asDefinition("N2")], constituents)).not.toThrow();
    expect(() =>
      defineConstituents([{ ...asDefinition("N2"), members: [["N2", 1]] }], constituents),
    ).toThrow("cyclicConstituent: N2");
  });

  it.each([
    { name: "A", speed: Number.NaN, coefficients: null },
    { name: "A", speed: 1 },
    { name: "A", speed: 1, coefficients: null, aliases: "B" },
    { name: "A", speed: 1, coefficients: null, members: [null] },
    { name: "A", speed: 28.9, coefficients: M2.coefficients },
    { name: "A", speed: 1, coefficients: null },
    {
      name: "A",
      speed: -M2.speed,
      coefficients: M2.coefficients!.map((k) => -k),
    },
    { name: "A", speed: 1, coefficients: [2, 0, 0, 0, 0, 0] },
    { name: "A", speed: 1, coefficients: [2, 0, 0, 0, 0, 0, 0.5] },
    { name: "A", speed: 1, coefficients: null, members: [["M2", Infinity]] },
  ])("rejects an invalid definition %#", (definition) => {
    expect(() => defineConstituents([definition as ConstituentDefinition], constituents)).toThrow(
      "invalidDefinition: A",
    );
  });

  it("rejects two definitions for one catalog entry", () => {
    expect(() =>
      defineConstituents([asDefinition("NU2"), asDefinition("nu2")], constituents),
    ).toThrow("duplicateConstituent: nu2");
  });

  it("rejects a definition that isn't an object", () => {
    expect(() => defineConstituents([null as unknown as ConstituentDefinition])).toThrow(
      "invalidDefinition: undefined",
    );
  });

  it.each(["Z0", "Zo"])("rejects a replacement for %s, which carries offsets", (name) => {
    expect(() =>
      defineConstituents([{ name, speed: 0, coefficients: [0, 0, 0, 0, 0, 0, 1] }], constituents),
    ).toThrow(`invalidDefinition: ${name} (Z0 carries offsets)`);
  });

  it("rejects definitions that aren't a list", () => {
    expect(() => defineConstituents({} as unknown as ConstituentDefinition[])).toThrow(
      "invalidDefinition: definitions must be an array",
    );
    expect(levels([{ name: "M2", amplitude: 1, phase: 30 }], { definitions: null })).toEqual(
      levels([{ name: "M2", amplitude: 1, phase: 30 }]),
    );
  });

  it("rejects a name defined twice", () => {
    expect(() => defineConstituents([asDefinition("A"), asDefinition("A")], constituents)).toThrow(
      "duplicateConstituent: A",
    );
  });

  it.each(["constructor", "toString", "__proto__"])("predicts a constituent named %s", (name) => {
    expect(
      levels([{ name, amplitude: 1, phase: 30 }], { definitions: [asDefinition(name)] }),
    ).toEqual(levels([{ name: "M2", amplitude: 1, phase: 30 }]));
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
    const definitions = [m2([d1, d2, d3, d4, d5, d6, d7 + 1])];
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
