import { describe, expect, test } from "vitest";
import {
  astro,
  constituents,
  fit,
  type FittedConstituent,
  type HarmonicConstituent,
  type HarmonicSample,
} from "../src/index.js";

const truth = [
  { name: "M2", amplitude: 1.2, phase: 40 },
  { name: "S2", amplitude: 0.4, phase: 80 },
  { name: "N2", amplitude: 0.25, phase: 20 },
  { name: "K1", amplitude: 0.35, phase: 200 },
  { name: "O1", amplitude: 0.25, phase: 180 },
  { name: "M4", amplitude: 0.05, phase: 300 },
];
const names = truth.map(({ name }) => name);
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * One fit's twelve estimates all land inside their 95% intervals only about
 * half the time, so a single fit is held to three standard deviations
 * (99.7%), and `coverage` checks the 95% rate over many noise draws.
 */
const expectWithinIntervals = (
  fitted: readonly FittedConstituent[],
  expected: readonly HarmonicConstituent[],
) =>
  fitted.forEach((c, i) => {
    const bound = 3 / 1.96;
    expect(Math.abs(c.amplitude - expected[i].amplitude)).toBeLessThanOrEqual(
      bound * c.amplitudeInterval!,
    );
    expect(angleDiff(c.phase, expected[i].phase)).toBeLessThanOrEqual(bound * c.phaseInterval!);
  });

const tide = (time: Date) => {
  const state = astro(time);
  return truth.reduce((height, { name, amplitude, phase }) => {
    const c = constituents[name];
    const { f, u } = c.correction(state);
    return height + amplitude * f * Math.cos(((c.value(state) + u - phase) * Math.PI) / 180);
  }, 0.5);
};

// Seeded so every run sees the same noise.
const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gaussian = (next: () => number) => () =>
  Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());

const hourly = (days: number, start = Date.UTC(2015, 0, 1)) =>
  Array.from({ length: days * 24 }, (_, i) => new Date(start + i * 3600000));
const days60 = hourly(60);
const clean60 = days60.map(tide);

/** Hourly synthetic tide plus AR(1) noise: φ = 0 is white, φ near 1 is red. */
const noisy = (seed: number, sigma: number, phi = 0): HarmonicSample[] => {
  const noise = gaussian(random(seed));
  let level = 0;
  return days60.map((time, i) => {
    level = phi * level + sigma * noise();
    return { time, value: clean60[i] + level };
  });
};

const coverage = (phi: number) => {
  const trials = 60;
  let inside = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const result = fit(noisy(seed, 0.1, phi), names, { confidence: true });
    result.constituents.forEach((c, i) => {
      if (Math.abs(c.amplitude - truth[i].amplitude) <= c.amplitudeInterval!) inside++;
      if (angleDiff(c.phase, truth[i].phase) <= c.phaseInterval!) inside++;
    });
  }
  return inside / (trials * names.length * 2);
};

const samples60 = () => noisy(9, 0.1);

describe("fit weights", () => {
  const samples = noisy(1, 0.1);

  test("a weight of two counts a sample twice", () => {
    const weights = samples.map((_, i) => (i % 3 ? 1 : 2));
    const weighted = fit(samples, names, { weights });
    const repeated = fit(
      samples.flatMap((s, i) => (i % 3 ? [s] : [s, s])),
      names,
    );
    expect(weighted.offset).toBeCloseTo(repeated.offset, 10);
    expect(weighted.rms).toBeCloseTo(repeated.rms, 10);
    weighted.constituents.forEach((c, i) => {
      expect(c.amplitude).toBeCloseTo(repeated.constituents[i].amplitude, 10);
      expect(angleDiff(c.phase, repeated.constituents[i].phase)).toBeLessThan(1e-8);
    });
  });

  test("a zero weight leaves a sample out", () => {
    const spiked = samples.map((s, i) => (i === 100 ? { ...s, value: 50 } : s));
    const weights = samples.map((_, i) => (i === 100 ? 0 : 1));
    const weighted = fit(spiked, names, { weights });
    const removed = fit(
      samples.filter((_, i) => i !== 100),
      names,
    );
    expect(weighted.offset).toBeCloseTo(removed.offset, 10);
    weighted.constituents.forEach((c, i) =>
      expect(c.amplitude).toBeCloseTo(removed.constituents[i].amplitude, 10),
    );
  });

  test("zero weights leave samples out of the intervals and the span", () => {
    const masked = samples.map((_, i) => (i >= 240 && i < 600 ? 0 : i < 1080 ? 1 : 0));
    const weighted = fit(samples, names, { weights: masked, confidence: true });
    const removed = fit(
      samples.filter((_, i) => masked[i] > 0),
      names,
      { confidence: true },
    );
    weighted.constituents.forEach((c, i) => {
      expect(c.snr).toBeCloseTo(removed.constituents[i].snr!, 6);
      expect(c.amplitudeInterval).toBeCloseTo(removed.constituents[i].amplitudeInterval!, 10);
    });
    expect(weighted.unseparable).toEqual(removed.unseparable);
  });

  test("count only weighted samples toward the record's size and span", () => {
    const three = samples.map((_, i) => (i < 3 ? 1 : 0));
    expect(() => fit(samples, ["M2", "S2"], { weights: three, dropDependent: true })).toThrow(
      "invalidSamples",
    );
    const instant = samples.map((_, i) => (i === 5 ? 1 : 0));
    expect(() => fit(samples, [], { weights: instant })).toThrow("invalidSamples");
  });

  test.each([
    [[1, 1]],
    [samples.map((_, i) => (i ? 1 : -1))],
    [samples.map((_, i) => (i ? 1 : NaN))],
    [samples.map((_, i) => (i ? 1 : Infinity))],
    [samples.map(() => 0)],
  ])("rejects invalid weights %#", (weights) => {
    expect(() => fit(samples, names, { weights })).toThrow("invalidWeights");
  });
});

describe("robust fit", () => {
  // One sample in fifty is a 1 m surge the QC missed.
  const surge = random(7);
  const samples = noisy(2, 0.05).map((s) => (surge() < 0.02 ? { ...s, value: s.value + 1 } : s));

  test("recovers constants that spikes pull an ordinary fit away from", () => {
    const ordinary = fit(samples, names, { confidence: true });
    const robust = fit(samples, names, { robust: true, confidence: true });
    expect(Math.abs(ordinary.offset - 0.5)).toBeGreaterThan(0.015);
    expect(Math.abs(robust.offset - 0.5)).toBeLessThan(0.005);
    expectWithinIntervals(robust.constituents, truth);
    expect(robust.constituents[0].amplitudeInterval).toBeLessThan(
      ordinary.constituents[0].amplitudeInterval!,
    );
  });

  test("keeps the caller's weights", () => {
    const weights = samples.map((_, i) => (i < 720 ? 1 : 0));
    const result = fit(samples, names, { robust: true, weights });
    const firstHalf = fit(samples.slice(0, 720), names, { robust: true });
    expect(result.offset).toBeCloseTo(firstHalf.offset, 8);
  });

  test("stops when most samples fit exactly", () => {
    const values = [0, 0, 0, 0, 10];
    const result = fit(
      values.map((value, i) => ({ time: new Date(i * 3600000), value })),
      [],
      { robust: true },
    );
    expect(result.offset).toBeCloseTo(2, 12);
  });
});

describe("rank-deficient fits", () => {
  const samples = noisy(3, 0.05);

  test("drop the later of two constituents on one line", () => {
    const result = fit(samples, ["M2", "MSf", "MSo"], { dropDependent: true });
    expect(result.dropped).toEqual(["MSo"]);
    expect(result.constituents.map((c) => c.name)).toEqual(["M2", "MSf"]);
  });

  test("drop a constituent that repeats the offset", () => {
    const result = fit(samples, [...names, "Z0"], { dropDependent: true, confidence: true });
    expect(result.dropped).toEqual(["Z0"]);
    expect(result.constituents.map((c) => c.name)).toEqual(names);
    expect(result.offset).toBeCloseTo(0.5, 2);
  });

  test("still throw without dropDependent", () => {
    expect(() => fit(samples, ["MSf", "MSo"])).toThrow("rankDeficient");
    expect(fit(samples, names).dropped).toEqual([]);
  });
});

describe("confidence intervals", () => {
  test.each([
    ["white", 0],
    ["red", 0.95],
  ])(
    "cover the true constants 95%% of the time under %s noise",
    (_, phi) => {
      const rate = coverage(phi);
      expect(rate).toBeGreaterThan(0.9);
      expect(rate).toBeLessThan(0.99);
    },
    30_000,
  );

  test("need more samples than parameters", () => {
    const three = days60.slice(0, 3).map((time, i) => ({ time, value: clean60[i] }));
    expect(() => fit(three, ["M2"], { confidence: true })).toThrow("invalidSamples");
    const weights = samples60().map((_, i) => (i < 3 ? 1 : 0));
    expect(() => fit(samples60(), ["M2"], { weights, confidence: true })).toThrow("invalidSamples");
  });

  test("widen where the residual spectrum is red", () => {
    const white = fit(noisy(4, 0.1), names, { confidence: true }).constituents;
    // AR(1) with φ = 0.95 and this innovation has about the same variance, mostly at low frequency.
    const red = fit(noisy(4, 0.1 * Math.sqrt(1 - 0.95 ** 2), 0.95), names, {
      confidence: true,
    }).constituents;
    const byName = (list: typeof white, name: string) => list.find((c) => c.name === name)!;
    // Diurnal noise rises much more than quarter-diurnal.
    expect(
      byName(red, "K1").amplitudeInterval! / byName(white, "K1").amplitudeInterval!,
    ).toBeGreaterThan(
      2 * (byName(red, "M4").amplitudeInterval! / byName(white, "M4").amplitudeInterval!),
    );
  });

  test("give SNR as amplitude squared over its variance", () => {
    const [m2] = fit(noisy(5, 0.1), names, { confidence: true }).constituents;
    expect(m2.snr).toBeCloseTo((m2.amplitude / (m2.amplitudeInterval! / 1.96)) ** 2, 6);
    expect(m2.snr).toBeGreaterThan(1000);
  });

  test("recover a multi-year record's constants within their intervals", () => {
    const noise = gaussian(random(6));
    const samples = hourly(730, Date.UTC(2018, 0, 1)).map((time) => ({
      time,
      value: tide(time) + 0.1 * noise(),
    }));
    const result = fit(samples, names, { confidence: true, robust: true });
    expectWithinIntervals(result.constituents, truth);
  });

  test("count a band with no frequencies to average, or no residual, as white", () => {
    const samples = hourly(2).map((time) => ({ time, value: tide(time) }));
    const result = fit(samples, ["M2", "K1"], { confidence: true });
    expect(result.constituents.every((c) => Number.isFinite(c.amplitudeInterval))).toBe(true);
    const flat = fit(
      [0, 1, 2].map((i) => ({ time: new Date(i * 3600000), value: 3 })),
      [],
      { confidence: true },
    );
    expect(flat.rms).toBe(0);
  });
});
