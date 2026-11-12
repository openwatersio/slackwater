import { describe, expect, test } from "vitest";
import { astro, constituents, foremanCandidates, selectConstituents } from "../src/index.js";

// Foreman (1977), Appendix 1: each standard constituent's frequency in cycles per hour.
const FOREMAN_FREQUENCIES: Record<string, number> = {
  Sa: 0.0001140741,
  Ssa: 0.0002281591,
  MSm: 0.0013097808,
  Mm: 0.0015121518,
  MSf: 0.0028219327,
  Mf: 0.0030500918,
  ALP1: 0.0343965699,
  "2Q1": 0.0357063507,
  sigma1: 0.0359087218,
  Q1: 0.0372185026,
  rho1: 0.0374208736,
  O1: 0.0387306544,
  tau1: 0.0389588136,
  BET1: 0.0400404353,
  NO1: 0.0402685944,
  chi1: 0.0404709654,
  pi1: 0.041438513,
  P1: 0.0415525871,
  S1: 0.0416666721,
  K1: 0.0417807462,
  psi1: 0.0418948203,
  phi1: 0.0420089053,
  theta1: 0.043090527,
  J1: 0.0432928981,
  SO1: 0.0446026789,
  OO1: 0.044830838,
  ups1: 0.0463429898,
  eps2: 0.0761773161,
  "2N2": 0.077487097,
  mu2: 0.077689408,
  N2: 0.0789992488,
  nu2: 0.0792016198,
  gamma2: 0.0803090296,
  H1: 0.0803973266,
  M2: 0.0805114007,
  H2: 0.0806254748,
  MKS2: 0.0807395598,
  lambda2: 0.0818211815,
  L2: 0.0820235525,
  T2: 0.0832192592,
  S2: 0.0833333333,
  R2: 0.0834474074,
  K2: 0.0835614924,
  MSN2: 0.0848454852,
  eta2: 0.0850736443,
  MO3: 0.1192420551,
  M3: 0.120767101,
  SO3: 0.1220639878,
  MK3: 0.1222921469,
  SK3: 0.1251140796,
  MN4: 0.1595106495,
  M4: 0.1610228013,
  SN4: 0.1623325821,
  MS4: 0.163844734,
  MK4: 0.1640728931,
  S4: 0.1666666667,
  SK4: 0.1668948258,
  "2MK5": 0.2028035475,
  "2SK5": 0.2084474129,
  "2MN6": 0.2400220501,
  M6: 0.241534202,
  "2MS6": 0.2443561347,
  "2MK6": 0.2445842938,
  "2SM6": 0.2471780673,
  MSK6: 0.2474062264,
  "3MK7": 0.2833149482,
  M8: 0.3220456027,
};

const truth = [
  { name: "M2", amplitude: 1.2, phase: 40 },
  { name: "S2", amplitude: 0.4, phase: 80 },
  { name: "N2", amplitude: 0.25, phase: 20 },
  { name: "K1", amplitude: 0.35, phase: 200 },
  { name: "O1", amplitude: 0.25, phase: 180 },
  { name: "P1", amplitude: 0.11, phase: 195 },
  { name: "K2", amplitude: 0.11, phase: 85 },
  { name: "M4", amplitude: 0.05, phase: 300 },
];
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const record = (days: number, stepHours = 1) => {
  // Seeded per record, so each test sees the same noise whatever runs before it.
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  return Array.from({ length: Math.floor((days * 24) / stepHours) }, (_, i) => {
    const time = new Date(Date.UTC(2016, 0, 1) + i * stepHours * 3600000);
    const state = astro(time);
    const value = truth.reduce((height, { name, amplitude, phase }) => {
      const c = constituents[name];
      const { f, u } = c.correction(state);
      return height + amplitude * f * Math.cos(((c.value(state) + u - phase) * Math.PI) / 180);
    }, 0);
    return { time, value: value + 0.05 * noise() };
  });
};

describe("foremanCandidates", () => {
  test("lists Foreman's standard constituents on his lines", () => {
    expect(foremanCandidates).toHaveLength(67);
    for (const { name, comparison } of foremanCandidates) {
      expect(FOREMAN_FREQUENCIES[name]).toBeDefined();
      expect(comparison === "Z0" || FOREMAN_FREQUENCIES[comparison!] !== undefined).toBe(true);
      // H1 and H2 aren't in the catalog; every other name resolves on Foreman's line.
      if (name === "H1" || name === "H2") expect(constituents[name]).toBeUndefined();
      else
        expect(Math.abs(constituents[name].speed / 360 - FOREMAN_FREQUENCIES[name])).toBeLessThan(
          1e-7,
        );
    }
  });
});

describe("selectConstituents", () => {
  test("keeps what fifteen days resolve, as Parker's pairs say", () => {
    const { selection } = selectConstituents(record(15));
    const entry = (name: string) => selection.find((s) => s.name === name)!;
    for (const name of ["M2", "S2", "K1", "O1"]) expect(entry(name).kept).toBe(true);
    expect(entry("N2")).toMatchObject({ kept: false, reason: "rayleigh", conflict: "M2" });
    expect(entry("Q1")).toMatchObject({ kept: false, reason: "rayleigh", conflict: "O1" });
    expect(entry("H1")).toEqual({ name: "H1", kept: false, reason: "unknown" });
  });

  test("compares a candidate whose comparison isn't in the catalog with that one's comparison", () => {
    // gamma2's comparison is H1, whose comparison is M2: 206 days apart.
    const { selection } = selectConstituents(record(100));
    expect(selection.find((s) => s.name === "gamma2")).toMatchObject({
      reason: "rayleigh",
      conflict: "M2",
    });
  });

  test("selects and recovers a 400-day record's constants within their intervals", () => {
    const { fit, selection } = selectConstituents(record(400));
    for (const { name, amplitude, phase } of truth) {
      const c = fit.constituents.find((c) => c.name === name)!;
      expect(selection.find((s) => s.name === name)!.kept).toBe(true);
      expect(Math.abs(c.amplitude - amplitude)).toBeLessThanOrEqual(
        (3 / 1.96) * c.amplitudeInterval!,
      );
      expect(angleDiff(c.phase, phase)).toBeLessThanOrEqual((3 / 1.96) * c.phaseInterval!);
      expect(c.snr).toBeGreaterThanOrEqual(2);
    }
    expect(selection.some((s) => s.reason === "snr")).toBe(true);
    for (const entry of selection.filter((s) => s.reason === "snr"))
      expect(entry.snr).toBeLessThan(2);
    expect(fit.constituents.map((c) => c.name)).toEqual(
      selection.filter((s) => s.kept).map((s) => s.name),
    );
  }, 30_000);

  test("compares candidates without a comparison with every one kept before them", () => {
    const { fit, selection } = selectConstituents(record(30), {
      candidates: [{ name: "Z0" }, { name: "M2" }, { name: "N2" }, { name: "S2" }, { name: "MSf" }],
      minSnr: 0,
    });
    expect(selection).toMatchObject([
      { name: "Z0", kept: false, reason: "rankDeficient" },
      { name: "M2", kept: true },
      { name: "N2", kept: true },
      { name: "S2", kept: true },
      { name: "MSf", kept: true },
    ]);
    expect(fit.constituents.map((c) => c.name)).toEqual(["M2", "N2", "S2", "MSf"]);
  });

  test("stops at comparisons that only name each other", () => {
    const { selection } = selectConstituents(record(15), {
      candidates: [
        { name: "M2" },
        { name: "X", comparison: "Y" },
        { name: "Y", comparison: "X" },
        { name: "S2", comparison: "X" },
      ],
    });
    expect(selection.map((s) => s.kept)).toEqual([true, false, false, true]);
  });

  test("leaves out constituents a coarse sampling interval aliases", () => {
    const { selection } = selectConstituents(record(60, 4));
    const entry = (name: string) => selection.find((s) => s.name === name)!;
    expect(entry("M4")).toEqual({ name: "M4", kept: false, reason: "nyquist" });
    expect(entry("M8")).toMatchObject({ reason: "nyquist" });
    expect(entry("M3")).not.toMatchObject({ reason: "nyquist" });
  });

  test("measures the record by the samples it weights", () => {
    const samples = record(60);
    const weights = samples.map((_, i) => (i < 15 * 24 ? 1 : 0));
    const { selection } = selectConstituents(samples, { weights });
    expect(selection.find((s) => s.name === "N2")).toMatchObject({ reason: "rayleigh" });
  });

  test("reports the SNR and dropped names of the fit it returns", () => {
    const { fit, selection } = selectConstituents(record(30), {
      candidates: [{ name: "Z0" }, { name: "M2" }, { name: "S2" }, { name: "MSf" }],
      minSnr: 50,
    });
    expect(fit.dropped).toEqual(["Z0"]);
    expect(selection.find((s) => s.name === "MSf")).toMatchObject({ reason: "snr" });
    for (const c of fit.constituents)
      expect(selection.find((s) => s.name === c.name)!.snr).toBe(c.snr);
  });

  test("rejects records too sparse for the candidates they resolve", () => {
    expect(() => selectConstituents([])).toThrow("invalidSamples");
    expect(() => selectConstituents(record(15), { weights: [1] })).toThrow("invalidWeights");
    expect(() => selectConstituents(record(15), { weights: record(15).map(() => 0) })).toThrow(
      "invalidWeights",
    );
    // Three hourly samples a month: hourly spacing, a 400-day span, 42 samples.
    const sparse = record(400).filter((_, i) => i % 720 < 3);
    expect(() => selectConstituents(sparse)).toThrow("invalidSamples");
  });
});
