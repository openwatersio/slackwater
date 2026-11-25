import { describe, expect, test } from "vitest";
import {
  astro,
  constituents,
  createCurrentPredictor,
  createTidePredictor,
  fit,
  foremanLines,
  type HarmonicSample,
} from "../src/index.js";
import { foreman } from "../src/node-corrections/index.js";

const latitude = 59.9;
// Kartverket fits on t_tide's lines: SA_KV for Sa, and M1, K1, MS4 and S1_KV, whose corrections
// take the perigee, the latitude factors, the products and a satellite of a solar line.
const truth = [
  { name: "SA_KV", amplitude: 0.08, phase: 210 },
  { name: "M2", amplitude: 1.2, phase: 100 },
  { name: "S2", amplitude: 0.4, phase: 140 },
  { name: "K1", amplitude: 0.3, phase: 200 },
  { name: "O1", amplitude: 0.2, phase: 50 },
  { name: "M1", amplitude: 0.02, phase: 300 },
  { name: "S1_KV", amplitude: 0.01, phase: 10 },
  { name: "MS4", amplitude: 0.05, phase: 75 },
];
const names = truth.map(({ name }) => name);
const offset = 0.5;

// Hourly over 2023 and 2024, with Foreman's corrections at each sample, as UTide fits.
const fundamentals = foreman(latitude);
const samples: HarmonicSample[] = Array.from({ length: 2 * 8760 }, (_, i) => {
  const time = new Date(Date.UTC(2023, 0, 1) + i * 3600000);
  const state = astro(time);
  const value = truth.reduce((sum, { name, amplitude, phase }) => {
    const c = constituents[name];
    const { f, u } = c.correction(state, fundamentals);
    return sum + amplitude * f * Math.cos(((c.value(state) + u - phase) * Math.PI) / 180);
  }, offset);
  return { time, value };
});

describe("Foreman's nodal corrections in prediction", () => {
  const fitted = fit(samples, names, { nodeCorrections: "foreman", latitude });
  const predictor = createTidePredictor(fitted.constituents, {
    offset: fitted.offset,
    nodeCorrections: "foreman",
    latitude,
  });

  test("predicts constants fitted with Foreman's set back to the data they were fitted to", () => {
    expect(fitted.rms).toBeLessThan(1e-9);
    // A level at one time takes its corrections at that time, as the fit does.
    for (const { time, value } of samples.filter((_, i) => i % 97 === 0))
      expect(predictor.getWaterLevelAtTime({ time }).level).toBeCloseTo(value, 9);
    // A timeline takes them once a day, at its middle.
    const timeline = predictor.getTimelinePrediction({
      start: samples[0].time,
      end: samples[24 * 60].time,
      timeFidelity: 3600,
    });
    timeline.forEach(({ level }, i) =>
      expect(Math.abs(level - samples[i].value)).toBeLessThan(1e-4),
    );
  });

  test("differs from IHO's corrections for the same constants", () => {
    const iho = createTidePredictor(fitted.constituents, { offset: fitted.offset });
    const time = samples[1000].time;
    expect(Math.abs(iho.getWaterLevelAtTime({ time }).level - samples[1000].value)).toBeGreaterThan(
      1e-3,
    );
  });

  test("predicts currents with Foreman's set on both axes", () => {
    const current = createCurrentPredictor(fitted.constituents, {
      meanFlow: fitted.offset,
      minorConstituents: fitted.constituents,
      minorMeanFlow: fitted.offset,
      azimuth: 0,
      nodeCorrections: "foreman",
      latitude,
    });
    const [point] = current.getTimelinePrediction({
      start: samples[0].time,
      end: samples[1].time,
    });
    expect(point.speed).toBeCloseTo(samples[0].value, 4);
    expect(point.magnitude).toBeCloseTo(Math.SQRT2 * Math.abs(samples[0].value), 4);
  });

  test("takes the site's latitude", () => {
    const south = createTidePredictor(fitted.constituents, {
      nodeCorrections: "foreman",
      latitude: -latitude,
    });
    const time = samples[0].time;
    expect(south.getWaterLevelAtTime({ time }).level).not.toBeCloseTo(
      predictor.getWaterLevelAtTime({ time }).level - fitted.offset,
      6,
    );
  });

  test.each([
    ["no latitude", { nodeCorrections: "foreman" }],
    ["a latitude with another set", { latitude }],
    ["a latitude with IHO's", { nodeCorrections: "iho", latitude }],
    ["an invalid latitude", { nodeCorrections: "foreman", latitude: Number.NaN }],
    ["a latitude past the pole", { nodeCorrections: "foreman", latitude: 91 }],
  ] as const)("rejects %s", (_, options) => {
    const harmonics = [{ name: "M2", amplitude: 1, phase: 0 }];
    expect(() => createTidePredictor(harmonics, options)).toThrow("invalidLatitude");
    expect(() => createCurrentPredictor(harmonics, options)).toThrow("invalidLatitude");
  });

  test.each([null, ""])("reads a %j set as IHO's", (nodeCorrections) => {
    const harmonics = [{ name: "M2", amplitude: 1, phase: 0 }];
    const options = { nodeCorrections: nodeCorrections as unknown as "iho" };
    const time = samples[0].time;
    expect(createTidePredictor(harmonics, options).getWaterLevelAtTime({ time }).level).toBe(
      createTidePredictor(harmonics).getWaterLevelAtTime({ time }).level,
    );
  });

  test("reports constituents that aren't an array as other sets do", () => {
    const options = { nodeCorrections: "foreman", latitude } as const;
    const predictor = createTidePredictor(null as unknown as [], options);
    expect(() => predictor.getWaterLevelAtTime({ time: samples[0].time })).toThrow(
      "Harmonic constituents are not an array",
    );
  });

  test("rejects an unknown set as fit does", () => {
    const options = { nodeCorrections: "t_tide" as "iho" };
    expect(() => createTidePredictor([], options)).toThrow("invalidNodeCorrections: t_tide");
  });

  test.each(["Sa", "SA", "S1", "OQ2", "OO2", "H1", "H2"])(
    "refuses %s, which isn't t_tide's line by that name",
    (name) => {
      const harmonics = [{ name, amplitude: 0.1, phase: 0 }];
      const options = { nodeCorrections: "foreman", latitude } as const;
      expect(() => createTidePredictor(harmonics, options)).toThrow(`notForemanLine: ${name}`);
      expect(() =>
        createCurrentPredictor([], { ...options, minorConstituents: harmonics }),
      ).toThrow("notForemanLine");
      // IHO's set predicts them as the catalog defines them.
      expect(() => createTidePredictor(harmonics)).not.toThrow();
    },
  );

  test("names t_tide's line for each name it refuses", () => {
    expect(() =>
      createTidePredictor([{ name: "Sa", amplitude: 0.1, phase: 0 }], {
        nodeCorrections: "foreman",
        latitude,
      }),
    ).toThrow(`notForemanLine: Sa (t_tide's is ${foremanLines.Sa})`);
  });

  test("predicts a caller's own definition under a name Foreman's set refuses", () => {
    const { speed, coefficients } = constituents.SA_KV;
    const definitions = [{ name: "Sa", speed, coefficients }];
    const own = createTidePredictor([{ name: "Sa", amplitude: 0.1, phase: 0 }], {
      nodeCorrections: "foreman",
      latitude,
      definitions,
    });
    const kv = createTidePredictor([{ name: "SA_KV", amplitude: 0.1, phase: 0 }], {
      nodeCorrections: "foreman",
      latitude,
    });
    const time = samples[0].time;
    expect(own.getWaterLevelAtTime({ time }).level).toBeCloseTo(
      kv.getWaterLevelAtTime({ time }).level,
      12,
    );
  });

  test("skips names the catalog doesn't know, as with other sets", () => {
    const options = { nodeCorrections: "foreman", latitude } as const;
    const harmonics = [{ name: "H3", amplitude: 0.1, phase: 0 }];
    expect(
      createTidePredictor(harmonics, options).getWaterLevelAtTime({ time: samples[0].time }).level,
    ).toBe(0);
  });
});
