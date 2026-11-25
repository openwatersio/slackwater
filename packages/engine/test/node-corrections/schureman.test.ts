import { describe, it, expect } from "vitest";
import fundamentals from "../../src/node-corrections/schureman.js";
import iho from "../../src/node-corrections/iho.js";
import astro, { AstroData } from "../../src/astronomy/index.js";
import constituents from "../../src/constituents/index.js";

// The turns of the perigee p in the catalog's argument for the line.
const turns = (name: string) => constituents[name]!.coefficients![3];

const testItems = {
  i: { value: 5 },
  I: { value: 6 },
  omega: { value: 3 },
  nu: { value: 4 },
  nup: { value: 4 },
  nupp: { value: 2 },
  P: { value: 14 },
  p: { value: 10 },
  xi: { value: 4 },
} as AstroData;

const sampleTime = new Date("2019-10-04T10:15:40.010Z");
const testAstro = astro(sampleTime);

describe("schuremanFundamentals", () => {
  it.each(Object.keys(fundamentals))("%s: produces f > 0 and finite u", (name) => {
    const result = fundamentals[name](testAstro, turns(name));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("Mm: Schureman equations 73, 65 — f only, u = 0", () => {
    const result = fundamentals.Mm(testItems, turns("Mm"));
    expect(result.f).toBeCloseTo(0.999051998091, 4);
    expect(result.u).toBe(0);
  });

  it("Mf: Schureman equations 74, 66 / u_Mf", () => {
    const result = fundamentals.Mf(testItems, turns("Mf"));
    expect(result.f).toBeCloseTo(4.00426673883, 4);
    expect(result.u).toBe(-8.0);
  });

  it("O1: Schureman equations 75, 67 / u_O1", () => {
    const result = fundamentals.O1(testItems, turns("O1"));
    expect(result.f).toBeCloseTo(2.00076050158, 4);
    expect(result.u).toBe(4.0);
  });

  it("J1: Schureman equations 76, 68 / u_J1", () => {
    const result = fundamentals.J1(testItems, turns("J1"));
    expect(result.f).toBeCloseTo(2.0119685329, 4);
    expect(result.u).toBe(-4);
  });

  it("OO1: Schureman equations 77, 69 / u_OO1", () => {
    const result = fundamentals.OO1(testItems, turns("OO1"));
    expect(result.f).toBeCloseTo(8.01402871709, 4);
    expect(result.u).toBe(-12.0);
  });

  it("M2: Schureman equations 78, 70 / u_M2", () => {
    const result = fundamentals.M2(testItems, turns("M2"));
    expect(result.f).toBeCloseTo(0.999694287563, 4);
    expect(result.u).toBe(0.0);
  });

  it("K1: Schureman equations 227, 226, 68 / u_K1", () => {
    const result = fundamentals.K1(testItems, turns("K1"));
    expect(result.f).toBeCloseTo(1.23843964182, 4);
    expect(result.u).toBe(-4);
  });

  it("L2: Schureman equations 215, 213, 204 / u_L2 (eq 214)", () => {
    const result = fundamentals.L2(testItems, turns("L2"));
    expect(result.f).toBeCloseTo(0.98517860327, 4);
    expect(result.u).toBeCloseTo(-0.449812364499, 4);
  });

  it("K2: Schureman equations 235, 234, 71 / u_K2", () => {
    const result = fundamentals.K2(testItems, turns("K2"));
    expect(result.f).toBeCloseTo(1.09775430048, 4);
    expect(result.u).toBe(-4.0);
  });

  it("M1: Schureman equations 206, 207, 195 / u_M1 (eq 202)", () => {
    const result = fundamentals.M1(testItems, turns("M1"));
    expect(result.f).toBeCloseTo(3.90452969083, 4);
    // ξ − ν + Q − p, with Q from eq 202
    expect(result.u).toBeCloseTo(7.09154172301 - 10, 4);
  });

  it("M1: f / f(O1) is 1/Qa, which eq 197 gives as (2.310 + 1.435 cos 2P)^½ at mean I", () => {
    for (const P of [0, 30, 60, 90, 135]) {
      const a = { ...testItems, I: { value: 23.45 }, P: { value: P } } as AstroData;
      const ratio = fundamentals.M1(a, turns("M1")).f / fundamentals.O1(a, turns("O1")).f;
      expect(ratio ** 2).toBeCloseTo(2.31 + 1.435 * Math.cos((2 * P * Math.PI) / 180), 2);
    }
  });

  it("M1: an argument without p keeps eq 202's u", () => {
    const withP = fundamentals.M1(testItems, turns("M1"));
    const withoutP = fundamentals.M1(testItems, 0);
    expect(withoutP.u - withP.u).toBeCloseTo(10, 10);
  });

  it("M1: Q turns with P, so u stays within a few degrees of IHO's over a nodal cycle", () => {
    for (let hour = 0; hour < 19 * 8766; hour += 240) {
      const a = astro(new Date(Date.UTC(2000, 0, 1) + hour * 3600000));
      const difference = fundamentals.M1(a, turns("M1")).u - iho.M1(a, turns("M1")).u;
      expect(Math.cos((difference * Math.PI) / 180)).toBeGreaterThan(Math.cos((3 * Math.PI) / 180));
    }
  });

  it("M3: Schureman equation 149 / u_Modd", () => {
    const result = fundamentals.M3(testItems, turns("M3"));
    expect(result.f).toBeCloseTo(0.999541466395, 4);
    expect(result.u).toBe(0);
  });
});
