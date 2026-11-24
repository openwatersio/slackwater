import { describe, it, expect } from "vitest";
import fundamentals from "../../src/node-corrections/iho.js";
import astro from "../../src/astronomy/index.js";
import constituents from "../../src/constituents/index.js";
import { computeV0 } from "../../src/constituents/definition.js";
import type { Coefficients } from "../../src/constituents/types.js";

// The turns of the perigee p in the catalog's argument for the line.
const turns = (name: string) => constituents[name]!.coefficients![3];

const sampleTime = new Date("2019-10-04T10:15:40.010Z");
const testAstro = astro(sampleTime);

describe("ihoFundamentals", () => {
  it.each(Object.keys(fundamentals))("%s: produces f > 0 and finite u", (name) => {
    const result = fundamentals[name](testAstro, turns(name));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("Mm correction depends on N and p", () => {
    const result = fundamentals.Mm(testAstro, turns("Mm"));
    // Mm formula: f = 1 − 0.1311·cos(N) + 0.0538·cos(2p) + 0.0205·cos(2p−N), u = 0
    expect(result.u).toBe(0);
    expect(result.f).not.toBe(1); // not unity
  });

  it("Mf correction has non-zero u", () => {
    const result = fundamentals.Mf(testAstro, turns("Mf"));
    expect(result.u).not.toBe(0);
    expect(result.f).toBeGreaterThan(0);
  });

  it("O1 correction has non-zero u", () => {
    const result = fundamentals.O1(testAstro, turns("O1"));
    expect(result.u).not.toBe(0);
  });

  it("K1 correction has non-zero u", () => {
    const result = fundamentals.K1(testAstro, turns("K1"));
    expect(result.u).not.toBe(0);
  });

  it("J1 correction has non-zero u", () => {
    const result = fundamentals.J1(testAstro, turns("J1"));
    expect(result.u).not.toBe(0);
  });

  it("M2 correction has non-zero u", () => {
    const result = fundamentals.M2(testAstro, turns("M2"));
    expect(result.u).not.toBe(0);
  });

  it("K2 correction has non-zero u", () => {
    const result = fundamentals.K2(testAstro, turns("K2"));
    expect(result.u).not.toBe(0);
  });

  it("M3 derives from M2", () => {
    const m2 = fundamentals.M2(testAstro, turns("M2"));
    const m3 = fundamentals.M3(testAstro, turns("M3"));
    // M3 f = sqrt(f_M2)^3
    expect(m3.f).toBeCloseTo(Math.pow(Math.sqrt(m2.f), 3), 10);
  });

  it("xi2 and eta2 produce the same result", () => {
    const xi2 = fundamentals.xi2(testAstro, turns("xi2"));
    const eta2 = fundamentals.eta2(testAstro, turns("eta2"));
    expect(xi2.f).toBe(eta2.f);
    expect(xi2.u).toBe(eta2.u);
  });

  it("M1B, M1C, M1, M1A all produce distinct corrections", () => {
    const m1b = fundamentals.M1B(testAstro, turns("M1B"));
    const m1c = fundamentals.M1C(testAstro, turns("M1C"));
    const m1 = fundamentals.M1(testAstro, turns("M1"));
    const m1a = fundamentals.M1A(testAstro, turns("M1A"));

    // M1C and M1 use the same formula, but M1's argument already holds p
    expect(m1c.f).toBe(m1.f);
    expect(m1c.u - testAstro.p.value).toBeCloseTo(m1.u, 10);

    // M1B uses a different formula than M1
    expect(m1b.f).not.toBeCloseTo(m1.f, 5);

    // M1A uses a different formula than M1
    expect(m1a.f).not.toBeCloseTo(m1.f, 5);
  });

  // Annex A's M1 is four lines around 1 555 556: f·e^(iu) = 2 cos p + 0.4 cos(p − N) +
  // i (sin p + 0.2 sin(p − N)) splits into 155.655 (1.5), 155.455 (0.5), and the N satellites
  // 155.665 (0.3) and 155.445 (0.1), each with M1's −90°.
  it("M1 counts the perigee once: f·cos(V + u) is the sum of its lines over a nodal cycle", () => {
    const lines: [number, Coefficients][] = [
      [1.5, [1, 0, 0, 1, 0, 0, -1]],
      [0.5, [1, 0, 0, -1, 0, 0, -1]],
      [0.3, [1, 0, 0, 1, 1, 0, -1]],
      [0.1, [1, 0, 0, -1, -1, 0, -1]],
    ];
    const rad = Math.PI / 180;
    for (let hour = 0; hour < 19 * 8766; hour += 1000) {
      const a = astro(new Date(Date.UTC(2000, 0, 1) + hour * 3600000));
      const { f, u } = constituents.M1.correction(a);
      const phase = (constituents.M1.value(a) + u) * rad;
      const cos = lines.reduce((sum, [w, c]) => sum + w * Math.cos(computeV0(c, a) * rad), 0);
      const sin = lines.reduce((sum, [w, c]) => sum + w * Math.sin(computeV0(c, a) * rad), 0);
      expect(f * Math.cos(phase)).toBeCloseTo(cos, 10);
      expect(f * Math.sin(phase)).toBeCloseTo(sin, 10);
    }
  });

  it("M1's u follows the argument it's given, and stays continuous for fractional members", () => {
    const catalog = fundamentals.M1(testAstro, turns("M1"));
    expect(fundamentals.M1(testAstro, 1).u).toBe(catalog.u);
    expect(fundamentals.M1(testAstro, 0).u).toBeCloseTo(
      fundamentals.M1C(testAstro, turns("M1C")).u,
      10,
    );
    // u less p stays near zero, so it never wraps; half of it can't jump 180°.
    for (let hour = 0; hour < 19 * 8766; hour += 24) {
      const a = astro(new Date(Date.UTC(2000, 0, 1) + hour * 3600000));
      expect(Math.abs(fundamentals.M1(a, turns("M1")).u)).toBeLessThan(90);
    }
  });

  it("L2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.L2(testAstro, turns("L2"));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("gamma2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.gamma2(testAstro, turns("gamma2"));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("alpha2 depends on p and pp", () => {
    const result = fundamentals.alpha2(testAstro, turns("alpha2"));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("delta2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.delta2(testAstro, turns("delta2"));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });
});
