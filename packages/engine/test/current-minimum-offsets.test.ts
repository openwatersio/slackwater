import { expect, test } from "vitest";
import fixture from "../../../fixtures/current-minimum-offsets.json";
import { reduceCurrentEvents } from "../src/currents.js";

test("minimum ebb offsets match the independently published NOS subordinate tables", () => {
  for (const row of fixture.events) {
    const [event] = reduceCurrentEvents(
      [{ time: new Date(row.referenceTime), speed: row.referenceSpeed, kind: "minEbb" }],
      fixture.offsets,
    );
    expect(event.kind).toBe("minEbb");
    expect(event.time).toEqual(new Date(row.subordinateTime));
    expect(Math.abs(event.speed - row.subordinateSpeed)).toBeLessThanOrEqual(
      fixture.speedToleranceKnots,
    );
  }
});
