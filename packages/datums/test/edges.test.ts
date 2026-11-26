import { describe, expect, test } from "vitest";
import {
  DATUM_EPOCH,
  computeDatums,
  computeDatumsFromObservations,
  prepareDatumObservations,
  resolveEpoch,
  toFixed,
  type Sample,
} from "../src/index.js";
import { rounded } from "../src/datum.js";

describe("computeDatums", () => {
  test("refuses constants that predict no turning points", () => {
    expect(() => computeDatums([])).toThrow("times array is empty");
  });

  test("reports the pinned epoch it predicted over by default", () => {
    const { start, end } = computeDatums([{ name: "M2", amplitude: 1, phase: 0 }]);
    expect({ start, end }).toEqual(DATUM_EPOCH);
  });

  test("gives each caller its own epoch dates", () => {
    computeDatums([{ name: "M2", amplitude: 1, phase: 0 }]).start.setUTCFullYear(2025);
    resolveEpoch({}).end.setUTCFullYear(2030);
    expect(DATUM_EPOCH.start.toISOString()).toBe("2007-01-01T00:00:00.000Z");
    expect(resolveEpoch({})).toEqual({
      start: new Date("2007-01-01T00:00:00Z"),
      end: new Date("2026-01-01T00:00:00Z"),
    });
  });

  test("predicts over the 19 years ending at a given end", () => {
    const end = new Date("2016-01-01T00:00:00Z");
    const result = computeDatums([{ name: "M2", amplitude: 1, phase: 0 }], { end });
    expect(result.start.toISOString()).toBe("1997-01-01T00:00:00.000Z");
    expect(result.end).toEqual(end);
    expect(resolveEpoch({ end })).toEqual({ start: result.start, end });
  });

  test("averages a tide whose turns skip whole tidal days", () => {
    const { datums } = computeDatums([{ name: "Sa", amplitude: 1, phase: 0 }]);
    expect(datums["MHW"]).toBeCloseTo(1, 2);
    expect(datums["MLW"]).toBeCloseTo(-1, 2);
  });

  test("takes TLT from the Vladimirsky constituents only", () => {
    const { datums } = computeDatums([
      { name: "L2", amplitude: 1, phase: 0 },
      { name: "M2", amplitude: 0, phase: 0 },
    ]);
    expect(datums["LAT"]).toBeLessThan(-0.5);
    expect(datums["TLT"]).toBe(0);
    expect(computeDatums([{ name: "L2", amplitude: 1, phase: 0 }]).datums).not.toHaveProperty(
      "TLT",
    );
  });

  test("omits the amplitude datums without M2", () => {
    const { datums } = computeDatums([{ name: "S2", amplitude: 1, phase: 0 }]);
    for (const datum of ["MHWS", "MLWS", "NLLW", "ALLW"]) expect(datums).not.toHaveProperty(datum);
  });
});

describe("computeDatumsFromObservations", () => {
  test("returns null with no observations", () => {
    expect(computeDatumsFromObservations([])).toBeNull();
    expect(prepareDatumObservations([], [])).toBeNull();
  });

  test("returns null for a record with no tide", () => {
    const start = Date.UTC(2021, 0, 1);
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: 5,
    }));
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });

  test("skips invalid observations while filling gaps", () => {
    const start = Date.UTC(2021, 0, 1);
    const constituents = [{ name: "S2", amplitude: 1, phase: 0 }];
    const samples: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: Math.cos((h * Math.PI) / 6),
    })).filter((_, h) => h % 120 < 24 || h % 120 >= 26);
    const result = prepareDatumObservations(
      [...samples, { time: new Date(NaN), level: 1 }, { time: new Date(start), level: NaN }],
      constituents,
    )!;
    expect(result.coverage.inferredHours).toBeGreaterThan(0);
    expect(result.samples.every((p) => Number.isFinite(p.level))).toBe(true);
  });
});

describe("observed preparation", () => {
  const start = Date.UTC(2021, 0, 1);
  const tide = (h: number) => Math.cos((h * Math.PI) / 6);
  const complete: Sample[] = Array.from({ length: 8760 }, (_, h) => ({
    time: new Date(start + h * 3600000),
    level: tide(h),
  }));

  test("checks the model's options on a record with no gaps", () => {
    const constituents = [{ name: "S2", amplitude: 1, phase: 0 }];
    expect(() =>
      computeDatumsFromObservations(complete, constituents, { nodeCorrections: "foreman" }),
    ).toThrow();
    expect(() =>
      computeDatumsFromObservations([], constituents, { nodeCorrections: "foreman" }),
    ).toThrow();
  });

  test("leaves a gap unfilled when the model predicts no finite level", () => {
    const gappy = complete.filter((_, h) => h !== 40);
    expect(prepareDatumObservations(gappy, [{ name: "M2", amplitude: NaN, phase: 0 }])).toBeNull();
  });

  test("leaves out a datum that comes out non-finite", () => {
    expect(rounded({ MHW: 1.23456, MSL: Infinity, MTL: NaN }, 1)).toEqual({ MHW: 2.235 });
  });
});

describe("toFixed", () => {
  test("returns a value that is not a number unchanged", () => {
    expect(toFixed("1.23456" as unknown as number, 3)).toBe("1.23456");
    expect(toFixed(1.23456, 3)).toBe(1.235);
  });
});
