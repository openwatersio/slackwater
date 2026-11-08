import { describe, expect, test, vi } from "vitest";
import input from "../../../fixtures/harmonic-fit.json";
import parity from "../../../fixtures/harmonic-fit-parity.json";
import invalid from "../../../fixtures/harmonic-fit-invalid.json";
import { astro, constituents, fit, type HarmonicFit, type HarmonicSample } from "../src/index.js";

const astronomy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/astronomy/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/astronomy/index.js")>();
  return {
    ...actual,
    default: (time: Date) => {
      astronomy.calls++;
      return actual.default(time);
    },
  };
});

const samples = input.cases[0].samples.map(({ t, v }) => ({ time: new Date(t), value: v }));
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const residualRms = (data: readonly HarmonicSample[], result: HarmonicFit) =>
  Math.sqrt(
    data.reduce((sum, { time, value }) => {
      const state = astro(time);
      const model = result.constituents.reduce((height, { name, amplitude, phase }) => {
        const c = constituents[name];
        const { f, u } = c.correction(state);
        return height + amplitude * f * Math.cos(((c.value(state) + u - phase) * Math.PI) / 180);
      }, result.offset);
      return sum + (model - value) ** 2;
    }, 0) / data.length,
  );

describe("fit", () => {
  test.each(input.cases)("matches the shared SVD oracle for $days days", (entry) => {
    const result = fit(
      entry.samples.map(({ t, v }) => ({ time: new Date(t), value: v })),
      input.basis,
    );
    const expected = parity.cases.find(({ days }) => days === entry.days)!.expected;
    expect(Math.abs(result.offset - expected.offset)).toBeLessThan(1e-7);
    expect(Math.abs(result.rms - expected.rms)).toBeLessThan(1e-7);
    expect(result.constituents).toHaveLength(expected.constituents.length);
    result.constituents.forEach((actual, i) => {
      expect(actual.name).toBe(expected.constituents[i].name);
      expect(Math.abs(actual.amplitude - expected.constituents[i].amplitude)).toBeLessThan(1e-6);
      expect(angleDiff(actual.phase, expected.constituents[i].phase)).toBeLessThan(1e-3);
    });
    expect(result.unseparable).toEqual(entry.expected.unseparable);
  });

  test("recovers unrounded coefficients with gaps and repeated timestamps", () => {
    const truth = [
      { name: "M2", amplitude: 1.23456789, phase: 359.999 },
      { name: "O1", amplitude: 0.3456789, phase: 0.001 },
    ];
    const signal: HarmonicSample[] = Array.from({ length: 800 }, (_, i) => {
      const time = new Date(Date.UTC(2010, 0, 1) + Math.floor(i / 2) * 37 * 3600000);
      const state = astro(time);
      const value = truth.reduce((sum, { name, amplitude, phase }) => {
        const c = constituents[name];
        const { f, u } = c.correction(state);
        return sum + amplitude * f * Math.cos(((c.value(state) + u - phase) * Math.PI) / 180);
      }, -2.3456789);
      return { time, value };
    });
    const result = fit(
      signal,
      truth.map(({ name }) => name),
    );
    expect(result.offset).toBeCloseTo(-2.3456789, 10);
    expect(result.rms).toBeLessThan(1e-10);
    expect(result.unseparable).toEqual([]);
    result.constituents.forEach((c, i) => {
      expect(c.amplitude).toBeCloseTo(truth[i].amplitude, 10);
      expect(angleDiff(c.phase, truth[i].phase)).toBeLessThan(1e-8);
    });
  });

  test("fits an offset without harmonics", () => {
    const result = fit(
      [
        { time: new Date(0), value: 1 },
        { time: new Date(1000), value: 3 },
      ],
      [],
    );
    expect(result.offset).toBeCloseTo(2, 12);
    expect(result.rms).toBeCloseTo(1, 12);
    expect(result.constituents).toEqual([]);
  });

  test("preserves residuals across batches with initially singular timestamps", () => {
    const data = Array.from({ length: 1200 }, (_, i) => ({
      time: new Date(i < 600 ? 0 : i * 3600000),
      value: i % 2 ? 1 : 3,
    }));
    const result = fit(data, []);
    expect(result.offset).toBeCloseTo(2, 12);
    expect(result.rms).toBeCloseTo(1, 12);
    const m2 = fit(data, ["M2"]);
    expect(m2.rms).toBeCloseTo(residualRms(data, m2), 12);
    expect(m2.rms).toBeLessThanOrEqual(result.rms);
  });

  test("fits a record that exactly fills a batch", () => {
    const data = Array.from({ length: 512 }, (_, i) => ({
      time: new Date(i * 3600000),
      value: i % 2 ? 1 : 3,
    }));
    const result = fit(data, []);
    expect(result.offset).toBeCloseTo(2, 12);
    expect(result.rms).toBeCloseTo(1, 12);
  });

  test("preserves repeated samples across batch boundaries", () => {
    const original = fit(samples, input.basis);
    const repeated = fit(
      samples.flatMap((s) => [s, s]),
      input.basis,
    );
    expect(repeated.offset).toBeCloseTo(original.offset, 10);
    expect(repeated.rms).toBeCloseTo(original.rms, 10);
    repeated.constituents.forEach((c, i) => {
      expect(c.amplitude).toBeCloseTo(original.constituents[i].amplitude, 9);
      expect(angleDiff(c.phase, original.constituents[i].phase)).toBeLessThan(1e-6);
    });
  });

  test("evaluates the astronomy once per sample", () => {
    astronomy.calls = 0;
    fit(samples, input.basis);
    expect(astronomy.calls).toBe(samples.length);
  });

  test("fits values near the largest finite number", () => {
    const result = fit(
      [
        { time: new Date(0), value: 5e307 },
        { time: new Date(1000), value: 5e307 },
      ],
      [],
    );
    expect(result.offset / 5e307).toBeCloseTo(1, 12);
    const spread = fit(
      [
        { time: new Date(0), value: 4e307 },
        { time: new Date(1000), value: 6e307 },
      ],
      [],
    );
    expect(spread.rms / 1e307).toBeCloseTo(1, 12);
  });

  test("rejects overflow in the solution", () => {
    expect(() =>
      fit(
        samples.map((s) => ({ ...s, value: Number.MAX_VALUE })),
        [],
      ),
    ).toThrow("rankDeficient");
  });

  test.each(invalid)("rejects shared invalid input %#", ({ samples, names, error }) => {
    expect(() =>
      fit(
        samples.map(({ t, v }) => ({ time: new Date(t), value: v })),
        names,
      ),
    ).toThrow(error);
  });

  test.each([NaN, Infinity, -Infinity])("rejects non-finite data %s", (value) => {
    expect(() => fit([{ ...samples[0], value }, ...samples.slice(1)], [])).toThrow(
      "invalidSamples",
    );
    expect(() => fit([{ time: new Date(value), value: 0 }, ...samples.slice(1)], [])).toThrow(
      "invalidSamples",
    );
  });
});
