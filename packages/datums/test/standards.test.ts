import { describe, expect, test } from "vitest";
import { createTidePredictor, type ConstituentDefinition } from "@slackwater/engine";
import {
  computeDatums,
  computeDatumsFromObservations,
  prepareDatumObservations,
  DATUM_EPOCH,
  resolveEpoch,
  type Sample,
} from "../src/index.js";
import { resolveConstituents } from "../src/constituents.js";
import { theoreticalLowestTide, tideTypes } from "../src/tlt.js";
import { checkTides, diur, exhl, pick, tabulateTurns } from "../src/tabulate.js";
import alpena from "./fixtures/alpena-2022-05.json";
import { merge } from "../src/observations.js";

const HOUR = 3600000;
const hourly = (start: number, hours: number, level: (h: number) => number): Sample[] =>
  Array.from({ length: hours }, (_, h) => ({ time: new Date(start + h * HOUR), level: level(h) }));
const byName = (constituents: { name: string; amplitude: number; phase: number }[]) =>
  resolveConstituents(constituents).find;

describe("harmonic datums", () => {
  const constituents = [
    { name: "M2", amplitude: 1, phase: 0 },
    { name: "S2", amplitude: 0.3, phase: 0 },
    { name: "K1", amplitude: 0.2, phase: 30 },
  ];

  test("shift every datum by a numeric offset, MSL and the amplitude datums included", () => {
    const plain = computeDatums(constituents).datums;
    const shifted = computeDatums(constituents, {}, { offset: 1 }).datums;
    expect(Object.keys(shifted)).toEqual(Object.keys(plain));
    for (const datum of Object.keys(plain))
      expect(shifted[datum]).toBeCloseTo(plain[datum]! + 1, 3);
    expect(shifted["MSL"]).toBe(1);
  });

  test("average LLWLT and HHWLT over complete calendar years only (Canadian Tidal Manual §5.7)", () => {
    const end = new Date("2016-07-01T00:00:00Z");
    const { start, datums } = computeDatums(constituents, { end });
    const extremes = createTidePredictor(constituents, {
      prominenceThreshold: 0,
    }).getExtremesPrediction({
      start,
      end,
    });
    const years = Array.from({ length: 18 }, (_, i) => 1998 + i);
    const inYear = (year: number) => extremes.filter((e) => e.time.getUTCFullYear() === year);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const lowest = years.map((year) =>
      Math.min(
        ...inYear(year)
          .filter((e) => e.low)
          .map((e) => e.level),
      ),
    );
    const highest = years.map((year) =>
      Math.max(
        ...inYear(year)
          .filter((e) => e.high)
          .map((e) => e.level),
      ),
    );
    expect(datums["LLWLT"]).toBeCloseTo(mean(lowest), 3);
    expect(datums["HHWLT"]).toBeCloseTo(mean(highest), 3);
  });

  test("keep HHWLT and LLWLT between the means and the astronomical bounds", () => {
    const { datums } = computeDatums(constituents);
    expect(datums["HAT"]).toBeGreaterThanOrEqual(datums["HHWLT"]!);
    expect(datums["HHWLT"]).toBeGreaterThan(datums["MHHW"]!);
    expect(datums["LLWLT"]).toBeLessThan(datums["MLLW"]!);
    expect(datums["LAT"]).toBeLessThanOrEqual(datums["LLWLT"]!);
  });

  test("start an epoch ending on 29 February on the 28th, 19 years earlier", () => {
    expect(resolveEpoch({ end: new Date("2024-02-29T00:00:00Z") }).start.toISOString()).toBe(
      "2005-02-28T00:00:00.000Z",
    );
  });

  test("report constituent names the engine doesn't know and leave them out", () => {
    const result = computeDatums([...constituents, { name: "TYPO", amplitude: 5, phase: 0 }]);
    expect(result.ignoredConstituents).toEqual(["TYPO"]);
    expect(result.datums).toEqual(computeDatums(constituents).datums);
  });

  test("resolve names through custom definitions", () => {
    const lunar = { name: "M2", speed: 28.9841042, coefficients: [2, 0, 0, 0, 0, 0, 0] as const };
    const result = computeDatums(
      [{ name: "LunarM2", amplitude: 1, phase: 0 }],
      {},
      { definitions: [{ ...lunar, coefficients: [...lunar.coefficients], aliases: ["LunarM2"] }] },
    );
    expect(result.ignoredConstituents).toEqual([]);
    expect(result.datums["MHWS"]).toBe(1);
  });

  test("refuse two entries for one constituent", () => {
    expect(() =>
      computeDatums([
        { name: "Sa", amplitude: 0.1, phase: 0 },
        { name: "SA", amplitude: 0.1, phase: 0 },
      ]),
    ).toThrow("duplicateConstituent: SA");
    const year = hourly(Date.UTC(2021, 0, 1), 8760, (h) => Math.cos((h * Math.PI) / 6));
    const twice = [
      { name: "Sa", amplitude: 0.1, phase: 0 },
      { name: "SA", amplitude: 0.1, phase: 0 },
    ];
    expect(computeDatumsFromObservations(year, twice)).not.toBeNull();
  });
});

describe("theoretical lowest tide (GB 12327-2022 Appendix J)", () => {
  test("classify the tide by the form ratio (H_K1 + H_O1) / H_M2", () => {
    const types = (k1: number, o1: number) =>
      tideTypes(
        byName([
          { name: "M2", amplitude: 1, phase: 0 },
          { name: "K1", amplitude: k1, phase: 0 },
          { name: "O1", amplitude: o1, phase: 0 },
        ]),
      );
    expect(types(0.25, 0.25)).toEqual(["semidiurnal"]);
    expect(types(1, 1)).toEqual(["semidiurnal", "diurnal"]);
    expect(types(2.5, 2)).toEqual(["diurnal"]);
  });

  test("lower a semidiurnal tide by its node-factored amplitudes", () => {
    // fM2 = 1.038 and fO1 = 0.806 for a semidiurnal tide (Table J.1); R1 reaches their sum.
    const tlt = theoreticalLowestTide(
      byName([
        { name: "M2", amplitude: 1, phase: 10 },
        { name: "O1", amplitude: 0.3, phase: 50 },
      ]),
    );
    expect(tlt).toBeCloseTo(-(1.038 + 0.806 * 0.3), 4);
  });

  test("lower a diurnal tide by K1's diurnal node factor", () => {
    expect(theoreticalLowestTide(byName([{ name: "K1", amplitude: 1, phase: 0 }]))).toBeCloseTo(
      -1.113,
      4,
    );
  });

  test("take the deeper of the two results for a mixed tide", () => {
    const constituents = byName([
      { name: "M2", amplitude: 1, phase: 0 },
      { name: "K1", amplitude: 1, phase: 0 },
    ]);
    expect(tideTypes(constituents)).toEqual(["semidiurnal", "diurnal"]);
    // L = fM2 + fK1: 1.038 + 0.882 with semidiurnal factors, 0.963 + 1.113 with diurnal ones.
    expect(theoreticalLowestTide(constituents)).toBeCloseTo(-(0.963 + 1.113), 4);
  });

  test("lower by the full annual amplitude whatever its phase", () => {
    const tlt = (phase: number) =>
      theoreticalLowestTide(
        byName([
          { name: "M2", amplitude: 1, phase: 0 },
          { name: "Sa", amplitude: 0.1, phase },
        ]),
      );
    expect(tlt(0)).toBeCloseTo(-1.138, 4);
    expect(tlt(77)).toBeCloseTo(-1.138, 4);
  });

  test("reach the lowest level the eight main constituents allow (formula J.1, no shallow terms)", () => {
    // Semidiurnal node factors (Table J.1), F = (0.2 + 0.15) / 1 = 0.35.
    const constants = [
      { name: "M2", amplitude: 1, phase: 30, f: 1.038, arg: [2, 0, 0, 0, 0] },
      { name: "S2", amplitude: 0.4, phase: 70, f: 1, arg: [2, 2, -2, 0, 0] },
      { name: "N2", amplitude: 0.2, phase: 10, f: 1.038, arg: [2, -1, 0, 1, 0] },
      { name: "K2", amplitude: 0.1, phase: 80, f: 0.748, arg: [2, 2, 0, 0, 0] },
      { name: "K1", amplitude: 0.2, phase: 200, f: 0.882, arg: [1, 1, 0, 0, 90] },
      { name: "O1", amplitude: 0.15, phase: 160, f: 0.806, arg: [1, -1, 0, 0, -90] },
      { name: "P1", amplitude: 0.07, phase: 190, f: 1, arg: [1, 1, -2, 0, -90] },
      { name: "Q1", amplitude: 0.03, phase: 140, f: 0.807, arg: [1, -2, 0, 1, -90] },
    ];
    // An independent search: the tide as a sum over the lunar and solar angles τ, s, h and p,
    // which Vladimirsky's method takes as free. h only moves S2 and P1, p only N2 and Q1.
    const rad = Math.PI / 180;
    const term = (c: (typeof constants)[number], tau: number, s: number, h: number, p: number) =>
      c.f *
      c.amplitude *
      Math.cos(
        (c.arg[0]! * tau + c.arg[1]! * s + c.arg[2]! * h + c.arg[3]! * p + c.arg[4]! - c.phase) *
          rad,
      );
    // The lowest tide over τ and s, with h and p each searched on their own.
    const lowestAt = (tau: number, s: number, step: number) => {
      let base = 0;
      for (const i of [0, 3, 4, 5]) base += term(constants[i]!, tau, s, 0, 0);
      let solar = Infinity;
      let perigee = Infinity;
      for (let x = 0; x < 360; x += step) {
        solar = Math.min(
          solar,
          term(constants[1]!, tau, s, x, 0) + term(constants[6]!, tau, s, x, 0),
        );
        perigee = Math.min(
          perigee,
          term(constants[2]!, tau, s, 0, x) + term(constants[7]!, tau, s, 0, x),
        );
      }
      return base + solar + perigee;
    };
    let best = { level: Infinity, tau: 0, s: 0 };
    for (let tau = 0; tau < 360; tau += 2)
      for (let s = 0; s < 360; s += 2) {
        const level = lowestAt(tau, s, 2);
        if (level < best.level) best = { level, tau, s };
      }
    let lowest = Infinity;
    for (let tau = best.tau - 2; tau <= best.tau + 2; tau += 0.1)
      for (let s = best.s - 2; s <= best.s + 2; s += 0.1)
        lowest = Math.min(lowest, lowestAt(tau, s, 0.1));
    expect(theoreticalLowestTide(byName(constants))).toBeCloseTo(lowest, 3);
  }, 15_000);

  test("add M4 and M6 at M2's low water", () => {
    // M2 is low when its argument is 180° + g; M4's is then 2(180° + 30°) − 100° = 320° and
    // M6's 3(180° + 30°) − 50° = 580°, with fM4 = 1.077 and fM6 = 1.118 (Table J.1).
    const m2 = { name: "M2", amplitude: 1, phase: 30 };
    const cos = (degrees: number) => Math.cos((degrees * Math.PI) / 180);
    expect(
      theoreticalLowestTide(byName([m2, { name: "M4", amplitude: 0.1, phase: 100 }])),
    ).toBeCloseTo(-1.038 + 1.077 * 0.1 * cos(320), 4);
    expect(
      theoreticalLowestTide(byName([m2, { name: "M6", amplitude: 0.1, phase: 50 }])),
    ).toBeCloseTo(-1.038 + 1.118 * 0.1 * cos(580), 4);
  });

  test("use both node-factor sets when none of M2, K1 and O1 is given", () => {
    expect(tideTypes(byName([{ name: "N2", amplitude: 1, phase: 0 }]))).toEqual([
      "semidiurnal",
      "diurnal",
    ]);
  });

  test("supply no TLT without any of its constituents", () => {
    expect(theoreticalLowestTide(byName([{ name: "L2", amplitude: 1, phase: 0 }]))).toBeUndefined();
  });
});

describe("observed datums", () => {
  const start = Date.UTC(2021, 0, 1);
  const cosine = (h: number) => Math.cos((h * Math.PI) / 6);

  test("end a window at the instant after its last hour", () => {
    const result = computeDatumsFromObservations(hourly(start, 8760, cosine))!;
    expect(result.end.toISOString()).toBe("2022-01-01T00:00:00.000Z");
  });

  test("leave the astronomical and annual datums to the harmonic reduction", () => {
    const { datums } = computeDatumsFromObservations(hourly(start, 8760, cosine))!;
    expect(Object.keys(datums).sort()).toEqual(["MHHW", "MHW", "MLLW", "MLW", "MSL", "MTL"]);
  });

  test("count a flat top once", () => {
    // Each day has a flat 1 m high over hours 0 and 1 and a single 0.6 m high at hour 12.
    const day = [
      1, 1, 0.6, 0.2, -0.2, -0.6, -1, -0.6, -0.2, 0.2, 0.4, 0.5, 0.6, 0.5, 0.3, 0.1, -0.1, -0.3,
      -0.4, -0.3, -0.1, 0.2, 0.5, 0.8,
    ];
    const { datums } = computeDatumsFromObservations(hourly(start, 8760, (h) => day[h % 24]!))!;
    expect(datums["MHW"]).toBeCloseTo((1 + 0.6) / 2, 3);
  });

  test("ignore a ripple between tides", () => {
    const tide = [1, 0.866, 0.5, 0.6, -0.5, -0.866, -1, -0.866, -0.5, 0, 0.5, 0.866];
    const { datums } = computeDatumsFromObservations(hourly(start, 8760, (h) => tide[h % 12]!))!;
    expect(datums["MHW"]).toBe(1);
    expect(datums["MLW"]).toBe(-1);
  });

  test("drop a high and low too close in height to be a tide", () => {
    // A diurnal tide whose semidiurnal part just makes a second, shallow turn pair each day.
    const level = (k: number) => (h: number) =>
      Math.cos(((2 * Math.PI) / 24) * h) + k * Math.cos(((2 * Math.PI) / 12) * h);
    const shallow = computeDatumsFromObservations(hourly(start, 8760, level(0.27)))!.datums;
    const double = computeDatumsFromObservations(hourly(start, 8760, level(0.45)))!.datums;
    expect(shallow["MHW"]).toBe(shallow["MHHW"]);
    expect(double["MHW"]).toBeLessThan(double["MHHW"]!);
  });

  test("take high and low waters from 6-minute observations", () => {
    const sixMinutes = Array.from({ length: 8760 * 10 }, (_, i) => ({
      time: new Date(start + i * 360000),
      level: 5 + 2 * Math.cos(((2 * Math.PI) / 12.42) * (i / 10)),
    }));
    const { datums } = computeDatumsFromObservations(sixMinutes)!;
    expect(datums["MHW"]).toBeCloseTo(7, 2);
    expect(datums["MLW"]).toBeCloseTo(3, 2);
    expect(datums["MSL"]).toBeCloseTo(5, 2);
  });

  test("anchor the window on the last complete month, not a stray late sample", () => {
    const year = hourly(Date.UTC(2024, 0, 1), 8784, cosine);
    const stray = { time: new Date("2050-01-01T00:00:00Z"), level: 0 };
    expect(computeDatumsFromObservations([...year, stray])).toEqual(
      computeDatumsFromObservations(year),
    );
  });

  test.each([
    ["a Z0 constant alone", [{ name: "Z0", amplitude: 0, phase: 0 }]],
    [
      "two Z0 constants",
      [
        { name: "Z0", amplitude: 0, phase: 0 },
        { name: "Z0", amplitude: 1, phase: 0 },
      ],
    ],
    ["a tide of zero amplitude", [{ name: "M2", amplitude: 0, phase: 0 }]],
    ["only a long-period tide", [{ name: "Sa", amplitude: 0.1, phase: 0 }]],
  ])("fill no gap from %s", (_, model) => {
    const gappy = hourly(start, 8760, cosine).filter((_, h) => h % 12 !== 0);
    expect(prepareDatumObservations(gappy, model)).toBeNull();
    // A 23-hour gap filled from a flat model would flatten the tides inside it.
    const outage = hourly(start, 8760, cosine).filter((_, h) => h % 200 < 100 || h % 200 >= 123);
    expect(prepareDatumObservations(outage, model)).toBeNull();
  });

  test("report unknown constituent names and use no model when none is known", () => {
    const gappy = hourly(start, 8760, cosine).filter((_, h) => h !== 40);
    const result = prepareDatumObservations(gappy, [{ name: "TYPO", amplitude: 1, phase: 0 }]);
    expect(result).toBeNull();
    const known = prepareDatumObservations(gappy, [
      { name: "S2", amplitude: 1, phase: 0 },
      { name: "TYPO", amplitude: 1, phase: 0 },
    ])!;
    expect(known.ignoredConstituents).toEqual(["TYPO"]);
    expect(known.coverage.inferredHours).toBe(1);
  });
});

describe("NOAA's high and low water criteria (TADC)", () => {
  const turn = (hours: number, level: number, high: boolean) => ({
    time: Date.UTC(2021, 0, 1) + hours * HOUR,
    level,
    high,
  });
  const levels = (turns: { level: number }[]) => turns.map((t) => t.level);

  test("drop a second turn of the same kind within 2 hours", () => {
    expect(levels(checkTides([turn(0, 1, true), turn(1, 1.1, true), turn(7, -1, false)]))).toEqual([
      1, -1,
    ]);
  });

  test("drop a high and low within 2 hours of each other, and resume after them", () => {
    const turns = [
      turn(0, -1, false),
      turn(6, 1, true),
      turn(7, -0.5, false),
      turn(13, 2, true),
      turn(19, -1, false),
    ];
    expect(levels(checkTides(turns))).toEqual([-1, 2, -1]);
  });

  test("drop a high and low within 0.03 m of each other", () => {
    expect(levels(checkTides([turn(0, 1, true), turn(6, 0.98, false), turn(12, 2, true)]))).toEqual(
      [2],
    );
  });

  test("keep turns exactly 2 hours or 3 cm apart", () => {
    expect(checkTides([turn(0, 1, true), turn(2, -1, false)])).toHaveLength(2);
    // 1.03 − 1 and 2.23 − 2.2 fall either side of 0.03 in floating point.
    expect(checkTides([turn(0, 1.03, true), turn(6, 1, false)])).toHaveLength(2);
    expect(checkTides([turn(0, 2.23, true), turn(6, 2.2, false)])).toHaveLength(2);
  });

  test("pair consecutive tides for a semidiurnal record (EXHL)", () => {
    expect(exhl([1, 2, 3, 1, 5])).toEqual([1, 2]);
    expect(exhl([2, 2])).toEqual([0]);
  });

  test("step a tidal day at a time for a diurnal record (DIUR)", () => {
    const start = Date.UTC(2021, 0, 1);
    // One high a day near noon, with a smaller extra high every third day.
    const times: number[] = [];
    const values: number[] = [];
    for (let day = 0; day < 9; day++) {
      times.push(start + (day * 24.84 + 12) * HOUR);
      values.push(1 + (day % 2) * 0.1);
      if (day % 3 === 1) {
        times.push(start + (day * 24.84 + 20) * HOUR);
        values.push(0.4);
      }
    }
    const marked = diur(times, values, start);
    expect(marked.map((i) => values[i])).not.toContain(0.4);
    expect(marked.length).toBeGreaterThanOrEqual(7);
  });
});

describe("TADC's edge cases", () => {
  const at = (hours: number[]) => hours.map((h) => h * HOUR);

  test("stop DIUR when a step can't advance past the last tide", () => {
    expect(diur(at([23, 56, 85, 98, 108]), [3, 1, 3, 1, 1], 0)).toEqual([0, 1, 2]);
  });

  // The marks expected in the next two tests are those of a hand transcription of TADC's DIUR
  // (tides.py at 04836aa, lines 95-212) for the same tides.
  test("search every tide when two picks land out of time order", () => {
    // One high a tidal day, and on the fourth a smaller one picked 36 minutes before it, as
    // at a gauge with almost no tide.
    const times = at([12, 36.8, 61.7, 86.5, 85.9, 111.4, 136.2, 161, 185.9]);
    const values = [1, 1.1, 1, 1.1, 0.4, 1, 1.1, 1, 1.1];
    expect(diur(times, values, 0)).toEqual([0, 1, 2, 3, 5, 6, 7]);
  });

  test("go on from a DIUR step that goes back in time", () => {
    expect(diur(at([2.9, 11.4, 8.6, 8.6, 78.9]), [0.1, 4.4, 0.1, 2.6, 3.9], 0)).toEqual([1]);
  });

  test("mark nothing for a DIUR step whose window holds no tide", () => {
    // From 12 h the steps reach 37 h and then go back to 9 h, so the window, from 24.5 h to
    // 23 h, is empty. TADC's Python reads the missing tide as the last one, at 200 h, and so
    // marks the tide at 12 h for that step and goes on from there.
    expect(diur(at([12, 37, 9, 200]), [5, 1, 1, 7], 0)).toEqual([]);
  });

  test("stop DIUR on returning to a step it has taken, where TADC loops", () => {
    expect(diur(at([46, 98, 106, 37, 85, 52, 89, 40]), [2, 4, 2, 4, 2, 4, 4, 5], 0)).toEqual([7]);
  });

  test("tabulate a gauge with almost no tide whose picks land out of time order", () => {
    // Six days at Alpena, Lake Huron, where two lows on 21 May are picked at 22:24 and 21:48.
    const start = Date.parse(alpena.start);
    const samples = (rows: number[][]) =>
      rows.map(([minutes, level]) => ({ time: new Date(start + minutes! * 60000), level: level! }));
    const turns = tabulateTurns(samples(alpena.hourly), samples(alpena.observations));
    const lows = turns.filter((turn) => !turn.high);
    const times = lows.map((turn) => +turn.time);
    expect(times.some((time, i) => i > 0 && time < times[i - 1]!)).toBe(true);
    // A transcription of TADC's DIUR marks the same highs and lows from these picks, but for
    // the last low, which it marks for a step whose window falls before it.
    const marked = (high: boolean) =>
      turns.filter((turn) => turn.high === high).flatMap((turn, i) => (turn.higher ? [i] : []));
    expect(marked(true)).toEqual([0, 1, 4, 6]);
    expect(marked(false)).toEqual([0, 2]);
  });

  test("mark nothing for a DIUR step whose window falls before it", () => {
    expect(diur(at([50, 74, 90, 93, 101, 105]), [3, 3, 2, 1, 1, 1], 0)).toEqual([0, 1]);
  });

  const series = (minutes: number[], levels: number[]) =>
    minutes.map((m, i) => ({ time: new Date(m * 60000), level: levels[i]! }));

  test("take the extreme observation within 30 minutes of a coarse record's turn", () => {
    const observations = series([0, 20, 40, 60], [0.8, 0.9, 1, 0.95]);
    expect(pick(observations, 20 * 60000, true).level).toBe(1);
    expect(pick(observations, 20 * 60000, false).level).toBe(0.8);
    expect(pick(observations, 60 * 60000, true).level).toBe(1);
  });

  test("fit a cubic around a fine record's turn, in a window that narrows with the range", () => {
    const minutes = Array.from({ length: 121 }, (_, i) => i * 6);
    const small = series(
      minutes,
      minutes.map((m) => 0.2 * Math.cos(((m - 360) / 60) * ((2 * Math.PI) / 12.42))),
    );
    expect(pick(small, 360 * 60000, true).level).toBeCloseTo(0.2, 3);
  });

  test("widen the fit to 6.5 hours where the local range reaches 0.5 m, as TADC does", () => {
    const minutes = Array.from({ length: 121 }, (_, i) => i * 6);
    const peak = (amplitude: number) =>
      pick(
        series(
          minutes,
          minutes.map((m) => amplitude * Math.cos(((m - 360) / 60) * ((2 * Math.PI) / 12.42))),
        ),
        360 * 60000,
        true,
      ).level;
    // Under 0.5 m of range TADC fits 2.5 hours; at 0.5 m, 6.5 hours, which flattens the peak.
    // A 0.46 m amplitude spans 0.49 m over the 6.5-hour search, 0.48 m spans 0.51 m.
    expect(peak(0.46)).toBeCloseTo(0.46, 3);
    expect(0.48 - peak(0.48)).toBeGreaterThan(0.004);
  });

  test("fall back to the extreme observation when the fit has too few points", () => {
    const observations = series([0, 10, 300, 600], [1, 1.2, 0, 1]);
    expect(pick(observations, 0, true).level).toBe(1.2);
  });

  test("merge filled points into the observations in time order", () => {
    const merged = merge(series([60, 180], [1, 3]), series([240, 120], [4, 2]));
    expect(merged.map((p) => p.level)).toEqual([1, 2, 3, 4]);
  });
});

describe("frames and names", () => {
  const tide = [{ name: "S2", amplitude: 1, phase: 0 }];

  test("treat a Z0 constant as an offset of every datum", () => {
    const plain = computeDatums(tide).datums;
    const { datums } = computeDatums([...tide, { name: "Z0", amplitude: 2, phase: 0 }]);
    for (const key of Object.keys(plain)) expect(datums[key]).toBeCloseTo(plain[key]! + 2, 3);
  });

  test("find M2's amplitude through a definition that takes its name as an alias", () => {
    const definitions: ConstituentDefinition[] = [
      { name: "LunarM2", speed: 28.9841042, coefficients: [2, 0, 0, 0, 0, 0, 0], aliases: ["M2"] },
    ];
    const { datums, ignoredConstituents } = computeDatums(
      [{ name: "M2", amplitude: 1, phase: 0 }],
      {},
      { definitions },
    );
    expect(ignoredConstituents).toEqual([]);
    expect(datums["MHWS"]).toBe(1);
    expect(datums["TLT"]).toBeDefined();
  });

  test("leave Foreman's refusals to the engine", () => {
    const constants = [
      { name: "M2", amplitude: 1, phase: 0 },
      { name: "H1", amplitude: 0.01, phase: 0 },
    ];
    expect(() =>
      computeDatums(constants, {}, { nodeCorrections: "foreman", latitude: 60 }),
    ).toThrow("H1");
    const year = hourly(Date.UTC(2021, 0, 1), 8760, (h) => Math.cos((h * Math.PI) / 6));
    expect(() => computeDatumsFromObservations(year, [], { nodeCorrections: "foreman" })).toThrow();
  });

  test("refuse an offset that is not finite, and leave out a datum the shift overflows", () => {
    expect(() => computeDatums(tide, {}, { offset: Infinity })).toThrow("invalidOffset");
    expect(() => computeDatums([...tide, { name: "Z0", amplitude: NaN, phase: 0 }])).toThrow(
      "invalidOffset",
    );
    expect(computeDatums(tide, {}, { offset: 1e306 }).datums).toEqual({});
  });

  test("count only the turns inside the epoch", () => {
    const end = new Date("2026-01-01T00:00:15Z");
    const shifted = [{ name: "S2", amplitude: 1, phase: 0.25 }];
    const { datums } = computeDatums(shifted, { end });
    const levels = createTidePredictor(shifted, { prominenceThreshold: 0 })
      .getExtremesPrediction(resolveEpoch({ end }))
      .filter((e) => e.time < end);
    expect(datums["HHWLT"]).toBeLessThanOrEqual(Math.max(...levels.map((e) => e.level)));
  });

  test("refuse an epoch end that is not a date", () => {
    expect(() => computeDatums(tide, { end: new Date(NaN) })).toThrow("invalidEpoch");
  });

  test("hand out fresh copies of the pinned epoch", () => {
    DATUM_EPOCH.end.setUTCFullYear(2030);
    expect(DATUM_EPOCH.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("observed edge cases", () => {
  const start = Date.UTC(2021, 0, 1);
  const cosine = (h: number) => Math.cos((h * Math.PI) / 6);

  test("average observations that share an instant, whatever their order", () => {
    const year = hourly(start, 8760, cosine);
    const peaks = year.filter((p) => p.level === 1).map((p) => ({ time: p.time, level: 3 }));
    const first = computeDatumsFromObservations([...peaks, ...year])!.datums;
    const last = computeDatumsFromObservations([...year, ...peaks])!.datums;
    expect(first).toEqual(last);
    expect(first["MHW"]).toBe(2);
  });

  test("weight a repeated sample once in its hourly mean", () => {
    const year = hourly(start, 8760, cosine);
    const sixMinutes = Array.from({ length: 10 }, (_, k) => ({
      time: new Date(start + 5 * HOUR + k * 360_000),
      level: k / 10,
    }));
    const samples = [...year.filter((_, h) => h !== 5), ...sixMinutes, ...sixMinutes.slice(0, 5)];
    expect(prepareDatumObservations(samples, [])!.samples[5]!.level).toBeCloseTo(0.45, 9);
  });

  test("fill a gap whose anchors were sampled almost together from its edges, not the cubic", () => {
    const samples = hourly(start, 8760, cosine).filter((_, h) => h !== 40);
    samples[38] = { time: new Date(start + 39 * HOUR - 1), level: 0 };
    const result = prepareDatumObservations(samples, [{ name: "S2", amplitude: 1, phase: 0 }])!;
    expect(result.coverage.inferredHours).toBe(1);
    expect(Math.abs(result.samples[40]!.level)).toBeLessThanOrEqual(1);
    // Without two real hours after it, the gap stays open and January is incomplete.
    const unedged = samples.filter((p) => +p.time !== start + 42 * HOUR);
    expect(prepareDatumObservations(unedged, [{ name: "S2", amplitude: 1, phase: 0 }])).toBeNull();
  });
});
