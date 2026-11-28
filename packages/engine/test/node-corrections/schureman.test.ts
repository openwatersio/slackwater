import { describe, it, expect } from "vitest";
import reference from "../../../../fixtures/schureman-equations.json" with { type: "json" };
import fundamentals from "../../src/node-corrections/schureman.js";
import iho from "../../src/node-corrections/iho.js";
import astro, { AstroData } from "../../src/astronomy/index.js";
import constituents from "../../src/constituents/index.js";

// The turns of the perigee p in the catalog's argument for the line.
const turns = (name: string) => constituents[name]!.coefficients![3];

const sampleTime = new Date("2019-10-04T10:15:40.010Z");
const testAstro = astro(sampleTime);
const testItems: AstroData = {
  ...testAstro,
  ...Object.fromEntries(
    Object.entries(reference.astronomy).map(([name, value]) => [name, { value, speed: 0 }]),
  ),
};

describe("schuremanFundamentals", () => {
  it.each(Object.keys(fundamentals))("%s: produces f > 0 and finite u", (name) => {
    const result = fundamentals[name](testAstro, turns(name));
    expect(result.f).toBeGreaterThan(0);
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Number.isFinite(result.u)).toBe(true);
  });

  it.each(Object.entries(reference.corrections))(
    "%s: matches the Schureman equation values",
    (name, expected) => {
      const result = fundamentals[name]!(testItems, turns(name));
      expect(Math.abs(result.f - expected.f)).toBeLessThan(1e-6);
      expect(Math.abs(result.u - expected.u)).toBeLessThan(1e-6);
    },
  );

  it("M1: f / f(O1) is 1/Qa, which eq 197 gives as (2.310 + 1.435 cos 2P)^½ at mean I", () => {
    for (const P of [0, 30, 60, 90, 135]) {
      const a: AstroData = {
        ...testItems,
        I: { ...testItems.I, value: 23.45 },
        P: { ...testItems.P, value: P },
      };
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
});
