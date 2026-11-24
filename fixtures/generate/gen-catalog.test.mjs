import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCatalog, validateForeman } from "./gen-catalog.mjs";

const entry = (name, members = null) => ({ name, speed: 1, coefficients: members ? null : [1, 0, 0, 0, 0, 0, 0], members });
test("generator rejects broken catalog definitions", () => {
  assert.doesNotThrow(() => validateCatalog([entry("M2"), entry("M4", [{ name: "M2", factor: 2 }])], { alias: "M2" }));
  for (const [entries, aliases] of [
    [[entry("M2"), entry("M2")], {}],
    [[{ ...entry("M2"), speed: NaN }], {}],
    [[{ ...entry("M2"), coefficients: [1] }], {}],
    [[entry("M4", [{ name: "missing", factor: 2 }])], {}],
    [[entry("M2", [{ name: "M2", factor: 1 }])], {}],
    [[entry("M2")], { alias: "missing" }],
    [[entry("M4", [{ name: "M4", factor: Infinity }])], {}],
  ]) assert.throws(() => validateCatalog(entries, aliases));
});

test("generator rejects broken Foreman tables", () => {
  const entries = [entry("M2"), entry("S2"), entry("M4"), entry("M(KS)2")];
  const table = { satellites: { M2: [[0, 1, 0, 0.5, 0.03, 0]], S2: [] }, products: { M4: [["M2", 2]] }, lines: { H1: "M2", H2: "M4" } };
  assert.doesNotThrow(() => validateForeman(table, entries));
  for (const broken of [
    { ...table, satellites: { ...table.satellites, missing: [] } },
    { ...table, satellites: { M2: [[0, 1, 0, 0.5, 0.03]] } },
    { ...table, satellites: { M2: [[0, 1, 0, 0.5, 0.03, 3]] } },
    { ...table, satellites: { M2: [[0, 1, 0, NaN, 0.03, 0]] } },
    { ...table, products: { missing: [["M2", 2]] } },
    { ...table, products: { M4: [["M(KS)2", 2]] } },
    { ...table, products: { M4: [["M2", Infinity]] } },
    { ...table, lines: { S2: "missing" } },
    { ...table, lines: { S2: "M(KS)2" } },
  ]) assert.throws(() => validateForeman(broken, entries));
});
