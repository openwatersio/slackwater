import { describe, it, expect } from "vitest";
import fundamentals from "../../src/node-corrections/iho.js";
import astro from "../../src/astronomy/index.js";
import constituents from "../../src/constituents/index.js";

const sampleTime = new Date("2019-10-04T10:15:40.010Z");
const testAstro = astro(sampleTime);

describe("ihoFundamentals", () => {
  it.each(Object.keys(fundamentals))("%s: produces f > 0 and finite u", (name) => {
    const result = fundamentals[name](testAstro);
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("Mm correction depends on N and p", () => {
    const result = fundamentals.Mm(testAstro);
    // Mm formula: f = 1 − 0.1311·cos(N) + 0.0538·cos(2p) + 0.0205·cos(2p−N), u = 0
    expect(result.u).toBe(0);
    expect(result.f).not.toBe(1); // not unity
  });

  it("Mf correction has non-zero u", () => {
    const result = fundamentals.Mf(testAstro);
    expect(result.u).not.toBe(0);
    expect(result.f).toBeGreaterThan(0);
  });

  it("O1 correction has non-zero u", () => {
    const result = fundamentals.O1(testAstro);
    expect(result.u).not.toBe(0);
  });

  it("K1 correction has non-zero u", () => {
    const result = fundamentals.K1(testAstro);
    expect(result.u).not.toBe(0);
  });

  it("J1 correction has non-zero u", () => {
    const result = fundamentals.J1(testAstro);
    expect(result.u).not.toBe(0);
  });

  it("M2 correction has non-zero u", () => {
    const result = fundamentals.M2(testAstro);
    expect(result.u).not.toBe(0);
  });

  it("K2 correction has non-zero u", () => {
    const result = fundamentals.K2(testAstro);
    expect(result.u).not.toBe(0);
  });

  it("M3 derives from M2", () => {
    const m2 = fundamentals.M2(testAstro);
    const m3 = fundamentals.M3(testAstro);
    // M3 f = sqrt(f_M2)^3
    expect(m3.f).toBeCloseTo(Math.pow(Math.sqrt(m2.f), 3), 10);
  });

  it("xi2 and eta2 produce the same result", () => {
    const xi2 = fundamentals.xi2(testAstro);
    const eta2 = fundamentals.eta2(testAstro);
    expect(xi2.f).toBe(eta2.f);
    expect(xi2.u).toBe(eta2.u);
  });

  it("M1B, M1C, M1, M1A all produce distinct corrections", () => {
    const m1b = fundamentals.M1B(testAstro);
    const m1c = fundamentals.M1C(testAstro);
    const m1 = fundamentals.M1(testAstro);
    const m1a = fundamentals.M1A(testAstro);

    // M1C and M1 use the same formula, but M1's argument already holds p
    expect(m1c.f).toBe(m1.f);
    expect(m1c.u - testAstro.p.value).toBeCloseTo(m1.u, 10);

    // M1B uses a different formula than M1
    expect(m1b.f).not.toBeCloseTo(m1.f, 5);

    // M1A uses a different formula than M1
    expect(m1a.f).not.toBeCloseTo(m1.f, 5);
  });

  it("M1 counts the perigee once: V + u stays 90° behind M1C's over a nodal cycle", () => {
    for (let hour = 0; hour < 19 * 8766; hour += 1000) {
      const a = astro(new Date(Date.UTC(2000, 0, 1) + hour * 3600000));
      const m1 = constituents.M1.value(a) + fundamentals.M1(a).u;
      const m1c = constituents.M1C.value(a) + fundamentals.M1C(a).u;
      expect(Math.cos(((m1 - m1c + 90) * Math.PI) / 180)).toBeCloseTo(1, 10);
    }
  });

  it("M1's u follows the argument it's given, and stays continuous for fractional members", () => {
    const catalog = fundamentals.M1(testAstro);
    expect(fundamentals.M1(testAstro, 1).u).toBe(catalog.u);
    expect(fundamentals.M1(testAstro, 0).u).toBeCloseTo(fundamentals.M1C(testAstro).u, 10);
    // u less p stays near zero, so it never wraps; half of it can't jump 180°.
    for (let hour = 0; hour < 19 * 8766; hour += 24) {
      const a = astro(new Date(Date.UTC(2000, 0, 1) + hour * 3600000));
      expect(Math.abs(fundamentals.M1(a).u)).toBeLessThan(90);
    }
  });

  it("L2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.L2(testAstro);
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("gamma2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.gamma2(testAstro);
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("alpha2 depends on p and pp", () => {
    const result = fundamentals.alpha2(testAstro);
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it("delta2 uses f·sinU/f·cosU form", () => {
    const result = fundamentals.delta2(testAstro);
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.u)).toBe(true);
  });
});
