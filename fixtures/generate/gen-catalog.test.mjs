import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "./gen-catalog.mjs";

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
