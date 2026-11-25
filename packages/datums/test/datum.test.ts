import { describe, test, expect } from "vitest";
import { createTidePredictor } from "@slackwater/engine";
import {
  computeDatums,
  computeDatumsFromObservations,
  parseGeslaSamples,
  type Sample,
} from "../datum.js";

describe("computeDatums", () => {
  test.each([0.05, 0.06])(
    "retains small daily tides beneath a %s m annual envelope",
    (annualAmplitude) => {
      const { datums } = computeDatums(
        [
          { name: "SA", amplitude: annualAmplitude, phase: 0 },
          { name: "M2", amplitude: 0.001, phase: 0 },
        ],
        {},
      );
      expect(datums["MHW"]).toBe(0.001);
      expect(datums["MLW"]).toBe(-0.001);
      expect(datums["MHHW"]!).toBeLessThan(0.005);
      expect(datums["MLLW"]!).toBeGreaterThan(-0.005);
      expect(datums["LAT"]).toBeCloseTo(-annualAmplitude - 0.001, 3);
      expect(datums["HAT"]).toBeCloseTo(annualAmplitude + 0.001, 3);
      expect(datums["TLT"]).toBe(datums["LAT"]);
    },
  );

  test("retains sub-centimeter daily tides beneath a monthly envelope", () => {
    const { datums } = computeDatums(
      [
        { name: "Mm", amplitude: 0.02, phase: 0 },
        { name: "M2", amplitude: 0.002, phase: 0 },
      ],
      {},
    );
    expect(datums["MHW"]!).toBeGreaterThan(0);
    expect(datums["MHW"]!).toBeLessThan(0.005);
    expect(datums["MLW"]!).toBeLessThan(0);
    expect(datums["MLW"]!).toBeGreaterThan(-0.005);
  });

  test.each(["SA", "Sa"])(
    "includes %s in the theoretical lowest tide subset",
    (name) => {
      const { datums } = computeDatums(
        [
          { name, amplitude: 0.05, phase: 0 },
          { name: "M2", amplitude: 0.001, phase: 0 },
        ],
        {},
      );
      expect(datums["TLT"]).toBe(-0.051);
    },
  );

  test("retains small restricted-subset turns when the complete tide has large turns", () => {
    const { datums } = computeDatums(
      [
        { name: "L2", amplitude: 1, phase: 0 },
        { name: "M2", amplitude: 0.001, phase: 0 },
      ],
      {},
    );
    expect(datums["TLT"]).toBe(-0.001);
    expect(datums["LAT"]!).toBeLessThan(-0.5);
  });

  test("retains both unequal highs and lows in each predicted tidal day", () => {
    const { datums } = computeDatums(
      [
        { name: "M2", amplitude: 1, phase: 0 },
        { name: "K1", amplitude: 0.5, phase: 0 },
      ],
      {},
    );
    expect(datums["MHHW"]! - datums["MHW"]!).toBeGreaterThan(0.1);
    expect(datums["MLW"]! - datums["MLLW"]!).toBeGreaterThan(0.1);
  });

  test("retains days with only one high and one low", () => {
    const { datums } = computeDatums(
      [{ name: "M1C", amplitude: 1, phase: 0 }],
      {},
    );
    expect(datums["MHW"]).toBe(1.574);
    expect(datums["MLW"]).toBe(-1.574);
    expect(datums["MHHW"]).toBeCloseTo(datums["MHW"]!, 2);
    expect(datums["MLLW"]).toBeCloseTo(datums["MLW"]!, 2);
  });
});

describe("computeDatumsFromObservations", () => {
  test("does not derive related means from different tidal-range populations", () => {
    const start = Date.UTC(2020, 0, 1);
    const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: (h < 24 * 200 ? 2 : 1) * Math.cos((h * Math.PI) / 6),
    })).filter((_, h) => h >= 24 * 200 || h % 24 !== 1);
    const result = computeDatumsFromObservations(samples, [
      { name: "S2", amplitude: 1, phase: 0 },
    ])!;
    expect(result).not.toBeNull();
    expect(result.datums["MHHW"]).toBeCloseTo(1.5, 1);
    expect(result.datums["MHW"]).toBeCloseTo(1.5, 1);
    expect(
      Math.abs(result.datums["MHHW"]! - result.datums["MHW"]!),
    ).toBeLessThan(0.01);
  });

  test("declines the whole observed family when only partial seasons are available", () => {
    const start = Date.UTC(2020, 0, 1);
    const samples = Array.from({ length: 24 * 800 }, (_, h) => ({
      time: new Date(start + h * 3600000),
      level: Math.sin((h * Math.PI) / 6),
    })).filter((_, h) => h % (24 * 90) < 24 * 45);
    expect(
      computeDatumsFromObservations(samples, [
        { name: "S2", amplitude: 1, phase: 0 },
      ]),
    ).toBeNull();
  });

  test("retains both cadences through the observed reduction when a model supports resampling", () => {
    const start = Date.UTC(2020, 0, 1),
      end = Date.UTC(2022, 0, 2);
    const constituents = [{ name: "S2", amplitude: 1, phase: 0 }];
    const predictor = createTidePredictor(constituents);
    const samples = Array.from({ length: (end - start) / 3600000 }, (_, h) => {
      const time = new Date(start + h * 3600000);
      return { time, level: 5 + predictor.getWaterLevelAtTime({ time }).level };
    }).filter((p, h) => +p.time >= Date.UTC(2021, 0, 1) || h % 3 === 0);
    const context = new Date(start - 3 * 3600000);
    samples.unshift({
      time: context,
      level: 5 + predictor.getWaterLevelAtTime({ time: context }).level,
    });
    const result = computeDatumsFromObservations(samples, constituents)!;
    expect(result.start.getUTCFullYear()).toBe(2020);
    expect(result.end.getUTCFullYear()).toBe(2021);
    expect(result.datums["MHW"]).toBeCloseTo(6, 2);
    expect(result.datums["MLW"]).toBeCloseTo(4, 2);
  });

  test("does not keep incomplete-day means when missing extrema lack reconstruction support", () => {
    const start = Date.UTC(2020, 0, 1);
    const levels = [
      2, 1.5, 1, 0, -1, -1.5, -2, -1.5, -1, 0, 0.5, 0.75, 1, 0.75, 0.5, 0, -0.5,
      -0.75, -1, -0.75, -0.5, 0, 1, 1.5,
    ];
    const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: levels[h % 24]!,
    })).filter((_, h) => h % 72 !== 1 && h % 72 !== 7);
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });

  test("declines all observed means rather than dropping only higher highs and lower lows", () => {
    const start = Date.UTC(2020, 0, 1);
    const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: Math.cos((h * Math.PI) / 6),
    })).filter((_, h) => h % 24 !== 1);
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });

  test.each([1, 3])(
    "does not classify gaps in %i-hour observations",
    (step) => {
      const start = Date.UTC(2020, 0, 1);
      const levels = [0, 1, 2, 1, 0, -1, -2, -1];
      const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
        time: new Date(start + h * step * 3600_000),
        level: levels[h % 8]!,
      })).filter((_, h) => h % 96 < 6 || h % 96 > 26);
      expect(
        computeDatumsFromObservations(samples, [
          { name: "S2", amplitude: 1, phase: 0 },
        ]),
      ).toBeNull();
    },
  );

  test("includes hourly highs and lows on tidal-day boundaries", () => {
    const start = Date.UTC(2020, 0, 1);
    const levels = [
      2, 1.5, 1, 0, -1, -1.5, -2, -1.5, -1, 0, 0.5, 0.75, 1, 0.75, 0.5, 0, -0.5,
      -0.75, -1, -0.75, -0.5, 0, 1, 1.5,
    ];
    const samples = Array.from({ length: 24 * 400 + 1 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: levels[h % 24]!,
    }));
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(datums["MHW"]).toBeCloseTo(1.5, 2);
    expect(datums["MLW"]).toBeCloseTo(-1.5, 2);
    expect(datums["MHHW"]! - datums["MHW"]!).toBeGreaterThan(0.4);
    expect(datums["MLW"]! - datums["MLLW"]!).toBeGreaterThan(0.4);
  });

  test("recovers MSL and range from a synthetic M2 tide in the gauge frame", () => {
    // 400 days (> 1 yr min) of hourly heights: M2 (12.42h) amplitude 2m about a
    // gauge mean of 5m. Datums should come back in that frame, not MSL=0.
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 400; h++) {
      samples.push({
        time: new Date(t0 + h * 3600_000),
        level: 5 + 2 * Math.sin((2 * Math.PI * h) / 12.42),
      });
    }

    const result = computeDatumsFromObservations(samples)!;
    expect(result).not.toBeNull();
    const MSL = result.datums["MSL"]!;
    const MHW = result.datums["MHW"]!;
    const MLW = result.datums["MLW"]!;

    expect(MSL).toBeCloseTo(5, 1); // mean of hourly heights, real gauge frame
    expect(MHW).toBeGreaterThan(MSL);
    expect(MLW).toBeLessThan(MSL);
    expect(MHW).toBeCloseTo(7, 1); // amplitude recovered (hourly sampling)
    expect(MLW).toBeCloseTo(3, 1);
  });

  test("returns null for records shorter than the minimum span", () => {
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 30; h++) {
      samples.push({ time: new Date(t0 + h * 3600_000), level: Math.sin(h) });
    }
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });
});

describe("parseGeslaSamples", () => {
  test("keeps use_flag=1 rows, drops nulls/flagged, converts to UTC", () => {
    const text = [
      "# SITE NAME Test",
      "# TIME ZONE HOURS 0",
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 00:00:00   1.2300 1 1",
      "2020/01/01 01:00:00 -99.9999 5 0", // missing -> excluded
      "2020/01/01 02:00:00   3.4000 3 0", // doubtful -> excluded
      "2020/01/01 03:00:00   2.1000 1 1",
    ].join("\n");

    const samples = parseGeslaSamples(text);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.level).toBe(1.23);
    expect(samples[0]!.time.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(samples[1]!.level).toBe(2.1);
  });
});
