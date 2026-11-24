import { describe, it, expect } from "vitest";
import astro from "../../src/astronomy/index.js";
import constituents from "../../src/constituents/index.js";
import { foreman } from "../../src/node-corrections/index.js";
import table from "../../src/node-corrections/foreman.json" with { type: "json" };
import reference from "../../../../fixtures/foreman-utide.json" with { type: "json" };

const turn = (degrees: number) => degrees - 360 * Math.round(degrees / 360);

describe("foreman", () => {
  // UTide's own f and u, written by scripts/gen-foreman.py and shared with Swift and Kotlin. The two astronomies differ in their
  // polynomials, which leaves about 1e-5 in f and 0.002° in u.
  it.each(reference.map((r) => [r.time, r.latitude, r.values] as const))(
    "matches UTide at %s, latitude %d",
    (time, latitude, values) => {
      const a = astro(new Date(time));
      const fundamentals = foreman(latitude);
      for (const [name, [f, u]] of Object.entries(values)) {
        const c = constituents[name].correction(a, fundamentals);
        expect(c.f, name).toBeCloseTo(f, 4);
        expect(Math.abs(turn(c.u - u)), name).toBeLessThan(0.01);
      }
    },
  );

  it("has UTide's values for every line in the table", () => {
    // M1 is a catalog name for t_tide's NO1, which UTide doesn't know by that name.
    const lines = [...Object.keys(table.satellites), ...Object.keys(table.products)].filter(
      (name) => name !== "M1",
    );
    for (const { values } of reference) expect(Object.keys(values).sort()).toEqual(lines.sort());
  });

  it("gives M1 the correction of its line, which t_tide calls NO1", () => {
    const a = astro(new Date("2010-05-01T00:00:00Z"));
    const fundamentals = foreman(60);
    expect(constituents.M1.correction(a, fundamentals)).toEqual(
      constituents.NO1.correction(a, fundamentals),
    );
  });

  it("adds p back for an M1 argument without it, at the argument's epoch", () => {
    const a = astro(new Date("2010-05-01T00:00:00Z"));
    const epoch = astro(new Date("2010-01-01T00:00:00Z"));
    const { M1 } = foreman(60);
    expect(turn(M1(a, 0, epoch).u - M1(a, 1).u - epoch.p.value)).toBeCloseTo(0, 9);
  });

  it("builds no product from M1 or NO1, the lines whose correction needs a perigee count", () => {
    for (const members of Object.values(table.products))
      expect((members as [string, number][]).map(([m]) => m)).not.toContain("M1");
    for (const members of Object.values(table.products))
      expect((members as [string, number][]).map(([m]) => m)).not.toContain("NO1");
  });

  it("holds the latitude 5° from the equator, on either side", () => {
    const a = astro(new Date("2010-05-01T00:00:00Z"));
    expect(foreman(0).K1(a, 0)).toEqual(foreman(4).K1(a, 0));
    expect(foreman(-1).K1(a, 0)).toEqual(foreman(-5).K1(a, 0));
    expect(foreman(-1).K1(a, 0)).not.toEqual(foreman(1).K1(a, 0));
  });

  it.each(["Sa", "SA_KV", "S1", "MSf", "MSm", "Mf"])(
    "leaves %s uncorrected, as t_tide does or has no such line",
    (name) => {
      const a = astro(new Date("2010-05-01T00:00:00Z"));
      expect(constituents[name].correction(a, foreman(60))).toEqual({ f: 1, u: 0 });
    },
  );

  it.each([Number.NaN, 91, -90.5])("rejects latitude %d", (latitude) => {
    expect(() => foreman(latitude)).toThrow("invalidLatitude");
  });
});
