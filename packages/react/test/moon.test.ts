import { describe, expect, test } from "vitest";
import {
  moonApsides,
  moonAt,
  moonLitPath,
  moonPhaseName,
  moonTideLabel,
} from "../src/utils/moon.js";

const DAY = 86_400_000;
const SYNODIC = 29.53;
const age = (days: number) => days / SYNODIC;

describe("moonPhaseName", () => {
  test("new and full hold 1.7 days either side", () => {
    expect(moonPhaseName(age(1.69))).toBe("New Moon");
    expect(moonPhaseName(age(1.71))).toBe("Waxing Crescent");
    expect(moonPhaseName(age(SYNODIC - 1.69))).toBe("New Moon");
    expect(moonPhaseName(age(SYNODIC - 1.71))).toBe("Waning Crescent");
    expect(moonPhaseName(age(SYNODIC / 2 - 1.69))).toBe("Full Moon");
    expect(moonPhaseName(age(SYNODIC / 2 + 1.69))).toBe("Full Moon");
    expect(moonPhaseName(age(SYNODIC / 2 - 1.71))).toBe("Waxing Gibbous");
    expect(moonPhaseName(age(SYNODIC / 2 + 1.71))).toBe("Waning Gibbous");
  });

  test("the quarters hold 1.4 days either side", () => {
    expect(moonPhaseName(age(SYNODIC / 4 - 1.39))).toBe("First Quarter");
    expect(moonPhaseName(age(SYNODIC / 4 + 1.39))).toBe("First Quarter");
    expect(moonPhaseName(age(SYNODIC / 4 - 1.41))).toBe("Waxing Crescent");
    expect(moonPhaseName(age(SYNODIC / 4 + 1.41))).toBe("Waxing Gibbous");
    expect(moonPhaseName(age((3 * SYNODIC) / 4 - 1.39))).toBe("Last Quarter");
    expect(moonPhaseName(age((3 * SYNODIC) / 4 + 1.39))).toBe("Last Quarter");
    expect(moonPhaseName(age((3 * SYNODIC) / 4 - 1.41))).toBe("Waning Gibbous");
    expect(moonPhaseName(age((3 * SYNODIC) / 4 + 1.41))).toBe("Waning Crescent");
  });
});

describe("moonTideLabel", () => {
  const at = Date.UTC(2026, 9, 10);
  const full = 0.5;
  const quarter = 0.25;
  const crescent = 0.15;

  test("spring at new and full, neap at the quarters, nothing between", () => {
    expect(moonTideLabel(full, at, undefined, undefined)).toBe("Spring tide");
    expect(moonTideLabel(0, at, undefined, undefined)).toBe("Spring tide");
    expect(moonTideLabel(quarter, at, undefined, undefined)).toBe("Neap tide");
    expect(moonTideLabel(0.75, at, undefined, undefined)).toBe("Neap tide");
    expect(moonTideLabel(crescent, at, undefined, undefined)).toBeUndefined();
  });

  test("perigean or apogean within two days of either apsis", () => {
    const near = at + 2 * DAY;
    const far = at - 2 * DAY - 1;
    expect(moonTideLabel(full, at, near, undefined)).toBe("Perigean spring tide");
    expect(moonTideLabel(quarter, at, near, undefined)).toBe("Perigean neap tide");
    expect(moonTideLabel(crescent, at, near, undefined)).toBe("Perigean tide");
    expect(moonTideLabel(full, at, far, near)).toBe("Apogean spring tide");
    expect(moonTideLabel(quarter, at, undefined, near)).toBe("Apogean neap tide");
    expect(moonTideLabel(crescent, at, undefined, near)).toBe("Apogean tide");
    expect(moonTideLabel(crescent, at, far, far)).toBeUndefined();
  });
});

describe("moonAt", () => {
  test("the full moon of 2024-10-17 is half way through the month and fully lit", () => {
    const moon = moonAt(Date.parse("2024-10-17T11:26:00Z"));
    expect(moon.phase).toBeCloseTo(0.5, 3);
    expect(moon.fraction).toBeGreaterThan(0.99);
  });

  test("a week after new it is waxing and about half lit; a week after full, waning", () => {
    const waxing = moonAt(Date.parse("2024-10-10T18:55:00Z"));
    expect(waxing.waxing).toBe(true);
    expect(waxing.fraction).toBeCloseTo(0.5, 1);
    expect(moonAt(Date.parse("2024-10-24T08:03:00Z")).waxing).toBe(false);
  });
});

describe("moonApsides", () => {
  test("the perigee and apogee nearest the time", () => {
    // The closest perigee of 2024, and the apogees either side of it on Oct 2 and Oct 29.
    const within = (t: number | undefined, iso: string) =>
      expect(Math.abs(t! - Date.parse(iso))).toBeLessThan(10 * 60_000);
    const before = moonApsides(Date.parse("2024-10-16T00:00:00Z"));
    within(before.perigee, "2024-10-17T00:51:00Z");
    within(before.apogee, "2024-10-02T19:38:00Z");
    const after = moonApsides(Date.parse("2024-10-17T00:00:00Z"));
    within(after.apogee, "2024-10-29T22:50:00Z");
  });

  test("labels the October 2024 supermoon a perigean spring tide", () => {
    const at = Date.parse("2024-10-17T11:26:00Z");
    const { perigee, apogee } = moonApsides(at);
    expect(moonTideLabel(moonAt(at).phase, at, perigee, apogee)).toBe("Perigean spring tide");
  });
});

describe("moonLitPath", () => {
  test("the right half, then back up a terminator as wide as the fraction says", () => {
    expect(moonLitPath(1, 6)).toBe("M0 -6A6 6 0 0 1 0 6A6 6 0 0 1 0 -6Z");
    expect(moonLitPath(0.5, 6)).toBe("M0 -6A6 6 0 0 1 0 6A0 6 0 0 1 0 -6Z");
    expect(moonLitPath(0.25, 6)).toBe("M0 -6A6 6 0 0 1 0 6A3 6 0 0 0 0 -6Z");
  });
});
