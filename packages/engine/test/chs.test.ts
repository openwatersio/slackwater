import { describe, expect, test } from "vitest";
import currentRecipe from "../../../fixtures/chs-current-fit.json";
import recipe from "../../../fixtures/chs-tide-fit.json";
import parityInput from "../../../fixtures/harmonic-fit.json";
import { chsCurrentFit, chsTideFit, constituents, projectChsCurrent } from "../src/index.js";

describe("chsTideFit", () => {
  test("matches the shared recipe fixture", () => {
    expect(chsTideFit.basis).toEqual(recipe.basis);
    expect(chsTideFit.days).toBe(recipe.days);
    expect(chsTideFit.sampleMinutes).toBe(recipe.sampleMinutes);
  });

  test("is the basis the fit parity fixtures exercise", () => {
    expect(parityInput.basis).toEqual(recipe.basis);
  });

  test("names only constituents the engine knows", () => {
    for (const name of chsTideFit.basis) expect(constituents[name], name).toBeDefined();
  });
});

describe("chsCurrentFit", () => {
  test("matches the shared recipe fixture", () => {
    expect(chsCurrentFit.speedSeries).toBe(currentRecipe.speedSeries);
    expect(chsCurrentFit.directionSeries).toBe(currentRecipe.directionSeries);
    expect(chsCurrentFit.basis).toEqual(currentRecipe.basis);
    expect(chsCurrentFit.days).toEqual(currentRecipe.days);
    expect(chsCurrentFit.sampleMinutes).toBe(currentRecipe.sampleMinutes);
    expect(chsCurrentFit.provisionalSlackMaxMinutes).toBe(currentRecipe.provisionalSlackMaxMinutes);
  });

  test("fits the tide basis", () => {
    expect(currentRecipe.basis).toEqual(recipe.basis);
  });
});

describe("projectChsCurrent", () => {
  const samples = (rows: { time: string; value: number }[]) =>
    rows.map((r) => ({ time: new Date(r.time), value: r.value }));

  test.each(currentRecipe.projections)("$note", (c) => {
    const projected = projectChsCurrent(samples(c.speeds), samples(c.directions), c.floodDirection);
    const expected = samples(c.expected);
    expect(projected.map((s) => s.time)).toEqual(expected.map((s) => s.time));
    projected.forEach((s, i) => expect(s.value).toBeCloseTo(expected[i].value, 12));
  });

  test("drops samples whose speed or direction is not a finite number", () => {
    const t = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 900_000);
    const speeds = [NaN, 2, null as unknown as number, 1].map((value, i) => ({
      time: t(i),
      value,
    }));
    const directions = [135, NaN, 135, 135].map((value, i) => ({ time: t(i), value }));
    expect(projectChsCurrent(speeds, directions, 135)).toEqual([{ time: t(3), value: 1 }]);
  });
});
