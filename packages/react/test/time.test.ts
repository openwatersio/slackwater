import { describe, expect, test } from "vitest";
import {
  chartTime,
  dayAnchor,
  dayLabel,
  days,
  leadTime,
  localNoon,
  nextDay,
  shortDate,
  spokenTime,
  startOfDay,
  sunBands,
} from "../src/utils/time.js";

const LA = "America/Los_Angeles";
const H = 3_600_000;

describe("startOfDay / nextDay", () => {
  test("station-local midnight", () => {
    expect(new Date(startOfDay(Date.parse("2026-10-10T23:00:00Z"), LA)).toISOString()).toBe(
      "2026-10-10T07:00:00.000Z",
    );
  });
  test("DST days are 25 and 23 hours", () => {
    const fallBack = startOfDay(Date.parse("2026-11-01T12:00:00Z"), LA);
    expect((nextDay(fallBack, LA) - fallBack) / H).toBe(25);
    const springForward = startOfDay(Date.parse("2026-03-08T12:00:00Z"), LA);
    expect((nextDay(springForward, LA) - springForward) / H).toBe(23);
  });
  test.each([
    // Clocks skip from 00:00 to 01:00, so these days begin at 01:00.
    [
      "America/Santiago",
      "2026-09-05T04:00:00.000Z",
      "2026-09-06T04:00:00.000Z",
      "2026-09-07T03:00:00.000Z",
    ],
    [
      "America/Havana",
      "2026-03-07T05:00:00.000Z",
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
    ],
  ])(
    "a day whose midnight DST skips begins at the change in %s",
    (zone, before, skipped, after) => {
      const start = Date.parse(before);
      const list = days(start, Date.parse(after) + 12 * H, zone, -33, -71);
      expect(list.map((d) => new Date(d.start).toISOString())).toEqual([before, skipped, after]);
      expect(list.map((d) => new Date(d.end).toISOString())).toEqual([
        skipped,
        after,
        new Date(Date.parse(after) + 24 * H).toISOString(),
      ]);
      expect(startOfDay(Date.parse(skipped) + 22 * H, zone)).toBe(Date.parse(skipped));
      expect(chartTime(localNoon(Date.parse(skipped), zone), zone, "en-GB")).toBe("12:00");
    },
  );
});

test("clock formats follow the locale", () => {
  const t = Date.parse("2026-09-20T23:22:00Z");
  expect(chartTime(t, LA, "en-US")).toMatch(/^4:22\sPM$/);
  expect(chartTime(t, LA, "en-GB")).toBe("16:22");
  expect(leadTime(t, LA, "en-US")).toMatch(/^Sep 20 · \u20074:22\sPM$/);
  expect(leadTime(Date.parse("2026-09-20T19:05:00Z"), LA, "en-US")).toMatch(/^Sep 20 · 12:05\sPM$/);
  expect(leadTime(t, LA, "en-GB")).toBe("20 Sept · 16:22");
  expect(shortDate(t, LA, "en-US")).toBe("Sep 20");
});

test("dayLabel", () => {
  const now = Date.parse("2026-10-10T20:00:00Z");
  const today = startOfDay(now, LA);
  expect(dayLabel(today, now, LA)).toBe("Today");
  expect(dayLabel(nextDay(today, LA), now, LA)).toBe("Tomorrow");
  expect(dayLabel(startOfDay(today - H, LA), now, LA)).toBe("Yesterday");
  expect(dayLabel(nextDay(nextDay(today, LA), LA), now, LA, "en-US")).toBe("Mon");
});

describe("days", () => {
  test("each civil day with its sunrise and sunset", () => {
    const start = Date.parse("2026-10-10T07:00:00Z");
    const list = days(start, start + 48 * H, LA, 48.4, -122.6);
    expect(list).toHaveLength(2);
    expect(chartTime(list[0].sunrise!, LA, "en-GB")).toBe("7:23");
    expect(chartTime(list[0].sunset!, LA, "en-GB")).toBe("18:30");
  });
  test("polar night has no sunrise or sunset", () => {
    const start = Date.parse("2026-12-21T00:00:00Z");
    const [day] = days(start, start + H, "UTC", 80, 0);
    expect(day.sunrise).toBeUndefined();
    expect(day.sunset).toBeUndefined();
  });
});

test("localNoon is 12 wall-clock hours in, even on DST days", () => {
  const springForward = startOfDay(Date.parse("2026-03-08T12:00:00Z"), LA);
  expect((localNoon(springForward, LA) - springForward) / H).toBe(11);
  const fallBack = startOfDay(Date.parse("2026-11-01T12:00:00Z"), LA);
  expect((localNoon(fallBack, LA) - fallBack) / H).toBe(13);
  expect(chartTime(localNoon(fallBack, LA), LA, "en-GB")).toBe("12:00");
});

test("spokenTime carries the date and zone", () => {
  expect(spokenTime(Date.parse("2026-10-14T23:22:00Z"), LA, "en-US")).toMatch(
    /^Oct 14, 4:22\sPM PDT$/,
  );
});

describe("sunBands", () => {
  test("pairs each sun event with the next by succession, across civil days", () => {
    // Each civil day's first sunset falls just after midnight, before its sunrise.
    const list = [
      { start: 0, end: 24 * H, sunset: 0.5 * H, sunrise: 6 * H },
      { start: 24 * H, end: 48 * H, sunset: 24.5 * H, sunrise: 30 * H },
    ];
    expect(sunBands(list)).toEqual([
      { from: 0.5 * H, to: 6 * H, night: true },
      { from: 6 * H, to: 24.5 * H, night: false },
      { from: 24.5 * H, to: 30 * H, night: true },
    ]);
    expect(dayAnchor(list[0], sunBands(list), "UTC")).toBe(15.25 * H);
    const normal = [
      { start: 0, end: 24 * H, sunrise: 6 * H, sunset: 18 * H },
      { start: 24 * H, end: 48 * H, sunrise: 30 * H },
    ];
    expect(sunBands(normal)).toEqual([
      { from: 6 * H, to: 18 * H, night: false },
      { from: 18 * H, to: 30 * H, night: true },
    ]);
  });
  test("draws nothing for a night with no following sunrise", () => {
    expect(sunBands([{ start: 0, end: 24 * H, sunset: 18 * H }])).toEqual([]);
  });
});

test("dayAnchor centers in the day's daylight, else at local noon", () => {
  const start = startOfDay(Date.parse("2026-10-10T20:00:00Z"), LA);
  const day = { start, end: nextDay(start, LA), sunrise: start + 7 * H, sunset: start + 18 * H };
  expect(dayAnchor(day, sunBands([day]), LA)).toBe(start + 12.5 * H);
  expect(dayAnchor({ start, end: day.end }, [], LA)).toBe(start + 12 * H);
});
