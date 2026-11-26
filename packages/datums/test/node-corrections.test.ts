import { describe, expect, test } from "vitest";
import {
  createTidePredictor,
  type HarmonicConstituent,
  type NodeCorrections,
} from "@slackwater/engine";
import {
  DATUM_EPOCH,
  computeDatums,
  computeDatumsFromObservations,
  observedMeanLevel,
  prepareDatumObservations,
  toFixed,
  type Sample,
} from "../src/index.js";

const solar = [{ name: "S2", amplitude: 1, phase: 0 }];
const semidiurnal = [{ name: "M2", amplitude: 1, phase: 0 }];
const diurnal = [
  { name: "K1", amplitude: 1, phase: 0 },
  { name: "O1", amplitude: 0.7, phase: 40 },
];
const longPeriod = [
  { name: "Mf", amplitude: 0.5, phase: 0 },
  { name: "Mm", amplitude: 0.3, phase: 0 },
  { name: "M2", amplitude: 0.05, phase: 0 },
];
const sets: NodeCorrections[] = ["iho", "schureman"];

// Each synthesis covers the whole epoch, so compute each set once per constituent list.
const differences = new Map<HarmonicConstituent[], Record<string, number>>();
function difference(constituents: HarmonicConstituent[], datum: string) {
  if (!differences.has(constituents)) {
    const iho = computeDatums(constituents, {}, { nodeCorrections: "iho" }).datums;
    const schureman = computeDatums(constituents, {}, { nodeCorrections: "schureman" }).datums;
    differences.set(
      constituents,
      Object.fromEntries(Object.keys(iho).map((key) => [key, schureman[key]! - iho[key]!])),
    );
  }
  return differences.get(constituents)![datum]!;
}

describe("computeDatums under each set of nodal corrections", () => {
  test("uses IHO's corrections by default", () => {
    const constituents = [...diurnal, ...longPeriod];
    expect(computeDatums(constituents)).toEqual(
      computeDatums(constituents, {}, { nodeCorrections: "iho" }),
    );
  });

  test("gives the same datums for a solar tide, which has no nodal modulation", () => {
    expect(computeDatums(solar, {}, { nodeCorrections: "schureman" }).datums).toEqual(
      computeDatums(solar, {}, { nodeCorrections: "iho" }).datums,
    );
  });

  test("gives the same M2 datums to the millimetre, where the two sets agree", () => {
    for (const datum of ["HAT", "MHW", "MLW", "LAT"])
      expect(difference(semidiurnal, datum)).toBe(0);
  });

  test("moves the astronomical bounds of a diurnal tide", () => {
    expect(difference(diurnal, "HAT")).toBeLessThan(-0.003);
    expect(difference(diurnal, "LAT")).toBeGreaterThan(0.003);
  });

  test("moves the astronomical bounds of a long-period tide by centimetres", () => {
    expect(difference(longPeriod, "HAT")).toBeLessThan(-0.05);
    expect(difference(longPeriod, "LAT")).toBeGreaterThan(0.02);
  });

  test.each(sets)("takes HAT and LAT from %s's own prediction over the epoch", (set) => {
    const constituents = [...diurnal, ...longPeriod];
    const levels = createTidePredictor(constituents, {
      nodeCorrections: set,
      prominenceThreshold: 0,
    })
      .getExtremesPrediction(DATUM_EPOCH)
      .map((e) => e.level);
    const { datums } = computeDatums(constituents, {}, { nodeCorrections: set });
    expect(datums["HAT"]).toBe(toFixed(Math.max(...levels), 3));
    expect(datums["LAT"]).toBe(toFixed(Math.min(...levels), 3));
  });

  test.each(sets)("keeps the %s datums in tidal order", (set) => {
    const { datums } = computeDatums([...semidiurnal, ...diurnal], {}, { nodeCorrections: set });
    const order = ["HAT", "MHHW", "MHW", "MSL", "MLW", "MLLW", "LAT"];
    for (let i = 1; i < order.length; i++)
      expect(datums[order[i - 1]!]!).toBeGreaterThan(datums[order[i]!]!);
  });

  test("passes Foreman's latitude through to the prediction", () => {
    expect(() => computeDatums(diurnal, {}, { nodeCorrections: "foreman" })).toThrow();
    const low = computeDatums(diurnal, {}, { nodeCorrections: "foreman", latitude: 10 });
    const high = computeDatums(diurnal, {}, { nodeCorrections: "foreman", latitude: 60 });
    expect(high.datums["HAT"]).not.toBe(low.datums["HAT"]);
  });
});

describe("observed datums under each set of nodal corrections", () => {
  const constituents = [
    ...diurnal,
    ...longPeriod.filter((c) => c.name !== "M2"),
    { name: "M2", amplitude: 1, phase: 15 },
  ];
  const start = Date.UTC(2020, 0, 1);
  const end = Date.UTC(2022, 0, 1);
  const options = { nodeCorrections: "schureman" } as const;
  const predictor = createTidePredictor(constituents, options);
  const truth: Sample[] = Array.from({ length: (end - start) / 3600000 }, (_, h) => {
    const time = new Date(start + h * 3600000);
    return { time, level: 5 + predictor.getWaterLevelAtTime({ time }).level };
  });
  const masked = truth.filter((_, h) => h % 120 < 24 || h % 120 >= 27);
  const expected = new Map(truth.map((p) => [+p.time, p.level]));
  const largestError = (samples: Sample[]) =>
    Math.max(...samples.map((p) => Math.abs(p.level - expected.get(+p.time)!)));

  test("fills gaps exactly with the corrections the constants were fitted under", () => {
    const result = prepareDatumObservations(masked, constituents, options)!;
    expect(result.samples.map((p) => +p.time)).toEqual(truth.map((p) => +p.time));
    expect(result.coverage).toEqual({
      months: 24,
      observedHours: masked.length,
      inferredHours: truth.length - masked.length,
    });
    expect(largestError(result.samples)).toBeLessThan(1e-9);
  });

  test("fills gaps with an error when the corrections do not match the constants", () => {
    const result = prepareDatumObservations(masked, constituents, { nodeCorrections: "iho" })!;
    expect(largestError(result.samples)).toBeGreaterThan(1e-6);
  });

  test("reduces the filled record to the same datums as the complete one", () => {
    const filled = computeDatumsFromObservations(masked, constituents, options)!;
    const complete = computeDatumsFromObservations(truth, constituents, options)!;
    expect(filled.coverage.inferredHours).toBeGreaterThan(0);
    expect([filled.start, filled.end, filled.datums]).toEqual([
      complete.start,
      complete.end,
      complete.datums,
    ]);
  });

  test("fills gaps under Foreman's corrections at the site's latitude", () => {
    const foreman = { nodeCorrections: "foreman", latitude: 60 } as const;
    const model = createTidePredictor(diurnal, foreman);
    const record: Sample[] = truth.map((p) => ({
      time: p.time,
      level: 5 + model.getWaterLevelAtTime({ time: p.time }).level,
    }));
    const exact = new Map(record.map((p) => [+p.time, p.level]));
    const gappy = record.filter((_, h) => h % 120 < 24 || h % 120 >= 27);
    const error = (latitude: number) =>
      Math.max(
        ...prepareDatumObservations(gappy, diurnal, { ...foreman, latitude })!.samples.map((p) =>
          Math.abs(p.level - exact.get(+p.time)!),
        ),
      );
    expect(error(60)).toBeLessThan(1e-9);
    expect(error(10)).toBeGreaterThan(1e-6);
  });

  test("passes the corrections to the gauge offset's gap fill", () => {
    expect(observedMeanLevel(masked, constituents, options)).toBeCloseTo(
      observedMeanLevel(truth, constituents, options)!,
      9,
    );
    expect(() => observedMeanLevel(masked, constituents, { nodeCorrections: "foreman" })).toThrow();
  });
});
