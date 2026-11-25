import { describe, expect, test } from "vitest";
import {
  computeDatums,
  computeDatumsFromObservations,
  prepareDatumObservations,
  resolveEpoch,
  type Sample,
} from "../src/index.js";

// Each test pins a known limitation listed in the README, so changing one is a deliberate, visible decision.
describe("known limitations", () => {
  test("a numeric offset moves the extremes-based datums but not MSL or the amplitude datums", () => {
    const constituents = [
      { name: "M2", amplitude: 1, phase: 0 },
      { name: "S2", amplitude: 0.3, phase: 0 },
    ];
    const plain = computeDatums(constituents).datums;
    const shifted = computeDatums(constituents, {}, { offset: 1 }).datums;
    for (const datum of ["HAT", "MHW", "MTL", "MLW", "LAT", "TLT"])
      expect(shifted[datum]).toBeCloseTo(plain[datum]! + 1, 3);
    for (const datum of ["MSL", "MHWS", "MLWS", "NLLW", "ALLW"])
      expect(shifted[datum]).toBe(plain[datum]);
  });

  test("observed LLWLT averages the lowest lows of partial calendar years", () => {
    const start = Date.UTC(2020, 5, 1);
    const end = Date.UTC(2021, 5, 1);
    const samples: Sample[] = Array.from({ length: (end - start) / 3600000 }, (_, h) => {
      const time = new Date(start + h * 3600000);
      const range = time.getUTCFullYear() === 2020 ? 1 : 2;
      return { time, level: range * Math.cos((h * Math.PI) / 6) };
    });
    const result = computeDatumsFromObservations(samples)!;
    expect(result.start.toISOString()).toBe("2020-06-01T00:00:00.000Z");
    expect(result.datums["LLWLT"]).toBe(-1.5);
  });

  test("an observed window ends at the start of its last hour, a harmonic epoch at its exclusive end", () => {
    const start = Date.UTC(2021, 0, 1);
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: Math.cos((h * Math.PI) / 6),
    }));
    expect(computeDatumsFromObservations(samples)!.end.toISOString()).toBe(
      "2021-12-31T23:00:00.000Z",
    );
    expect(computeDatums([{ name: "M2", amplitude: 1, phase: 0 }]).end.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("a constituent the engine does not know leaves the cubic to fill gaps alone", () => {
    const start = Date.UTC(2021, 0, 1);
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: Math.cos((h * Math.PI) / 6),
    })).filter((_, h) => h !== 40);
    expect(prepareDatumObservations(samples, [])).toBeNull();
    const result = prepareDatumObservations(samples, [{ name: "TYPO", amplitude: 1, phase: 0 }])!;
    expect(result.coverage.inferredHours).toBe(1);
  });

  test("one late timestamp moves the observed window past the rest of the record", () => {
    const start = Date.UTC(2024, 0, 1);
    const samples: Sample[] = Array.from({ length: 8784 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: Math.cos((h * Math.PI) / 6),
    }));
    expect(computeDatumsFromObservations(samples)).not.toBeNull();
    expect(
      computeDatumsFromObservations([
        ...samples,
        { time: new Date("2050-01-01T00:00:00Z"), level: 0 },
      ]),
    ).toBeNull();
  });

  test("an epoch ending on 29 February starts on 1 March", () => {
    expect(resolveEpoch({ end: new Date("2024-02-29T00:00:00Z") }).start.toISOString()).toBe(
      "2005-03-01T00:00:00.000Z",
    );
  });

  test("two equal hourly heights at a peak count as two highs", () => {
    const start = Date.UTC(2021, 0, 1);
    // Each day has a flat 1 m high over hours 0 and 1 and a single 0.6 m high at hour 12.
    const day = [
      1, 1, 0.6, 0.2, -0.2, -0.6, -1, -0.6, -0.2, 0.2, 0.4, 0.5, 0.6, 0.5, 0.3, 0.1, -0.1, -0.3,
      -0.4, -0.3, -0.1, 0.2, 0.5, 0.8,
    ];
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: day[h % 24]!,
    }));
    const { datums } = computeDatumsFromObservations(samples)!;
    // One high per peak would give (1 + 0.6) / 2.
    expect(datums["MHW"]).toBeCloseTo((1 + 1 + 0.6) / 3, 2);
  });

  test("an observed ripple of any size counts as a high and a low", () => {
    const start = Date.UTC(2021, 0, 1);
    const tide = [1, 0.866, 0.5, 0, -0.5, -0.866, -1, -0.866, -0.5, 0, 0.5, 0.866];
    // A 0.1 m rise on the falling limb at hour 3 of every cycle.
    const rippled = tide.map((level, h) => (h === 3 ? 0.6 : level));
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: rippled[h % 12]!,
    }));
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(datums["MHW"]).toBeCloseTo((1 + 0.6) / 2, 3);
    expect(datums["MLW"]).toBeCloseTo((-1 + 0.5) / 2, 3);
  });
});
