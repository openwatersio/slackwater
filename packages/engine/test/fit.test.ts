import { describe, expect, test, vi } from "vitest";
import input from "../../../fixtures/harmonic-fit.json";
import parity from "../../../fixtures/harmonic-fit-parity.json";
import invalid from "../../../fixtures/harmonic-fit-invalid.json";
import { astro, constituents, fit, type HarmonicFit, type HarmonicSample } from "../src/index.js";
import { foreman, schureman, type Fundamentals } from "../src/node-corrections/index.js";

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

  // Hourly over 2023 and 2024, from M2, K1 and M1 with the given terms at each time.
  const synthetic = (terms: (time: Date, name: string) => { v: number; f: number; u: number }) =>
    Array.from({ length: 2 * 8760 }, (_, i) => {
      const time = new Date(Date.UTC(2023, 0, 1) + i * 3600000);
      const value = truthNodal.reduce((sum, { name, amplitude, phase }) => {
        const { v, f, u } = terms(time, name);
        return sum + amplitude * f * Math.cos(((v + u - phase) * Math.PI) / 180);
      }, 0.5);
      return { time, value };
    });
  const truthNodal = [
    { name: "M2", amplitude: 1.2, phase: 100 },
    { name: "K1", amplitude: 0.4, phase: 200 },
    { name: "M1", amplitude: 0.02, phase: 300 },
  ];
  const recovers = (result: HarmonicFit) => {
    expect(result.rms).toBeLessThan(1e-9);
    result.constituents.forEach((c, i) => {
      expect(c.amplitude).toBeCloseTo(truthNodal[i].amplitude, 9);
      expect(angleDiff(c.phase, truthNodal[i].phase)).toBeLessThan(1e-6);
    });
  };
  const names = truthNodal.map(({ name }) => name);

  test.each([
    ["schureman", schureman, {}],
    ["foreman", foreman(59.9), { latitude: 59.9 }],
  ] as const)("fits with %s corrections", (nodeCorrections, fundamentals, options) => {
    const data = synthetic((time, name) => {
      const state = astro(time);
      return {
        ...constituents[name].correction(state, fundamentals),
        v: constituents[name].value(state),
      };
    });
    recovers(fit(data, names, { nodeCorrections, ...options }));
    // IHO's corrections leave a residual, so the option took effect.
    expect(fit(data, names).rms).toBeGreaterThan(1e-4);
  });

  // The argument at January 1 advanced at the constituent's speed, and f and u at July 2.
  const yearlyTerms = (fundamentals: Fundamentals) => (time: Date, name: string) => {
    const year = time.getUTCFullYear();
    const january = new Date(new Date(0).setUTCFullYear(year, 0, 1));
    const start = astro(january);
    const c = constituents[name];
    const hours = (time.getTime() - january.getTime()) / 3600000;
    return {
      ...c.correction(astro(new Date(new Date(0).setUTCFullYear(year, 6, 2))), fundamentals, start),
      v: c.value(start) + c.speed * hours,
    };
  };

  test.each([
    ["schureman", schureman, {}],
    ["foreman", foreman(59.9), { latitude: 59.9 }],
  ] as const)(
    "fits a year at a time with %s corrections",
    (nodeCorrections, fundamentals, options) => {
      const data = synthetic(yearlyTerms(fundamentals));
      recovers(fit(data, names, { nodeCorrections, nodal: "yearly", ...options }));
      expect(fit(data, names, { nodeCorrections, ...options }).rms).toBeGreaterThan(1e-4);
    },
  );

  test("fits years 0 to 99 a year at a time in their own century", () => {
    // Three-hourly in years 23 and 24, which keeps the test fast under coverage.
    const terms = yearlyTerms(schureman);
    const data = Array.from({ length: (2 * 8760) / 3 }, (_, i) => {
      const time = new Date(new Date(Date.UTC(2023, 0, 1) + i * 3 * 3600000).setUTCFullYear(0));
      time.setUTCFullYear(23 + Math.floor(i / (8760 / 3)), 0, 1);
      time.setUTCHours((i % (8760 / 3)) * 3);
      const value = truthNodal.reduce((sum, { name, amplitude, phase }) => {
        const { v, f, u } = terms(time, name);
        return sum + amplitude * f * Math.cos(((v + u - phase) * Math.PI) / 180);
      }, 0.5);
      return { time, value };
    });
    expect(data[0].time.getUTCFullYear()).toBe(23);
    recovers(fit(data, names, { nodeCorrections: "schureman", nodal: "yearly" }));
  });

  test.each(["Sa", "SA", "S1", "OQ2"])(
    "refuses %s with Foreman's set, whose line it isn't",
    (name) => {
      const data = synthetic(yearlyTerms(schureman)).slice(0, 2000);
      expect(() => fit(data, [name, "M2"], { nodeCorrections: "foreman", latitude: 60 })).toThrow(
        "notForemanLine",
      );
      expect(() => fit(data, [name, "M2"])).not.toThrow();
    },
  );

  test("fits a caller's own definition under a name Foreman's set refuses", () => {
    const data = synthetic(yearlyTerms(schureman)).slice(0, 2000);
    const definitions = [
      {
        name: "S1",
        speed: 15,
        coefficients: [1, 1, -1, 0, 0, 0, 0] as [
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ],
      },
    ];
    expect(() =>
      fit(data, ["S1", "M2"], { definitions, nodeCorrections: "foreman", latitude: 60 }),
    ).not.toThrow();
  });

  test("reproduces NOAA's yearly M1, whose argument leaves p out", () => {
    // Schureman's second form: V = T − s + h − 90° at January 1, advanced at the catalog's
    // speed, and u = ξ − ν + Q at July 2 (Parker 2007; Schureman eq. 202).
    const data = synthetic((time, name) => {
      const year = time.getUTCFullYear();
      const start = astro(new Date(Date.UTC(year, 0, 1)));
      const middle = astro(new Date(Date.UTC(year, 6, 2)));
      const c = constituents[name];
      const hours = (time.getTime() - Date.UTC(year, 0, 1)) / 3600000;
      const v = c.value(start) + c.speed * hours;
      if (name !== "M1") return { ...c.correction(middle, schureman), v };
      return { ...schureman.M1(middle, 0), v: v - start.p.value };
    });
    recovers(fit(data, names, { nodeCorrections: "schureman", nodal: "yearly" }));
  });

  test("rejects Foreman's corrections without a latitude, and an unknown set or nodal mode", () => {
    expect(() => fit(samples, ["M2"], { nodeCorrections: "foreman" })).toThrow("invalidLatitude");
    expect(() =>
      fit(samples, ["M2"], { nodeCorrections: "foreman", latitude: null as unknown as number }),
    ).toThrow("invalidLatitude");
    expect(() =>
      fit(samples, ["M2"], { nodeCorrections: "foreman", latitude: "60" as unknown as number }),
    ).toThrow("invalidLatitude");
    expect(() => fit(samples, ["M2"], { latitude: 60 })).toThrow("invalidLatitude");
    for (const name of ["constructor", "", "IHO"])
      expect(() => fit(samples, ["M2"], { nodeCorrections: name as "iho" })).toThrow(RangeError);
    expect(() =>
      fit(samples, ["M2"], { nodeCorrections: "foreman", latitude: Number.NaN }),
    ).toThrow("invalidLatitude");
    expect(() => fit(samples, ["M2"], { nodal: "daily" as "exact" })).toThrow("invalidNodal");
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

  test("evaluates the astronomy twice a year in yearly mode", () => {
    const years = new Set(samples.map((s) => s.time.getUTCFullYear()));
    astronomy.calls = 0;
    fit(samples, input.basis, { nodal: "yearly" });
    expect(astronomy.calls).toBe(2 * years.size);
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
