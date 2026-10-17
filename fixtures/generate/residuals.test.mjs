import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { godinWeights, oracleFilter, generate } from "./gen-residuals.mjs";

test("Godin support is symmetric, normalized, and preserves constants", () => {
  assert.equal(godinWeights.length, 71);
  assert.deepEqual(godinWeights, [...godinWeights].reverse());
  assert.equal(
    godinWeights.reduce((a, b) => a + b, 0),
    14400,
  );
  const samples = Array.from({ length: 71 }, (_, i) => ({ time: i * 3600000, value: 0.15 }));
  const result = oracleFilter(samples);
  assert.equal(result.length, 1);
  assert.equal(result[0].time, 35 * 3600000);
  assert(Math.abs(result[0].value - 0.15) < 1e-12);
});

test("offline drift check detects altered oracle output", () => {
  const dir = mkdtempSync(join(tmpdir(), "residuals-oracle-"));
  const path = join(dir, "parity.json");
  try {
    generate(path, false);
    generate(path, true);
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    fixture.cases[0].filtered[0].value += 0.01;
    writeFileSync(path, JSON.stringify(fixture));
    assert.throws(() => generate(path, true), /fixture drift/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
