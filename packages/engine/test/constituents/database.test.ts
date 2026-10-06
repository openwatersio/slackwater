import { test, expect } from "vitest";
import { stations } from "@slackwater/database";
import constituents from "../../src/constituents/index.js";
import type { Constituent } from "../../src/constituents/index.js";

const usedConstituents = new Set(
  stations.flatMap((station) => station.harmonic_constituents || []).map(({ name }) => name),
);

test.each(Array.from(usedConstituents))("%s is supported", (name) => {
  expect(constituents[name], `Unsupported constituent: ${name}`).toBeDefined();
});

// Two names resolving to one model are predicted as a single summed term at one speed.
test("no station carries two names for the same constituent", () => {
  const duplicates = stations.flatMap((station) => {
    const seen = new Map<Constituent, string>();
    return (station.harmonic_constituents || []).flatMap(({ name }) => {
      const model = constituents[name];
      const other = seen.get(model);
      seen.set(model, name);
      return other ? [`${station.id}: ${other} and ${name} both resolve to ${model.name}`] : [];
    });
  });
  expect(duplicates).toEqual([]);
});
