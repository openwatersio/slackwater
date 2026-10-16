import { describe, expect, test } from "vitest";
import {
  fortnightWindow,
  maxSpeeds,
  nextMaxTile,
  peakRank,
  rangeTile,
  swingHeights,
} from "../src/utils/standing.js";
import type { CurrentEvent, Extreme } from "../src/types.js";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 10);
const tz = "America/Los_Angeles";
const extreme = (hours: number, level: number, high: boolean): Extreme => ({
  time: new Date(t0 + hours * H),
  level,
  high,
  low: !high,
  label: high ? "High" : "Low",
});
const event = (hours: number, speed: number, kind: CurrentEvent["kind"]): CurrentEvent => ({
  time: new Date(t0 + hours * H),
  speed,
  kind,
});

describe("fortnightWindow", () => {
  test("fifteen station-local days either side of the day containing the time", () => {
    expect(fortnightWindow(Date.parse("2026-10-15T19:00:00Z"), tz)).toEqual({
      start: "2026-09-30T07:00:00.000Z",
      end: "2026-10-30T07:00:00.000Z",
    });
  });

  test("whole local days across a DST change", () => {
    expect(fortnightWindow(Date.parse("2026-11-10T19:00:00Z"), tz)).toEqual({
      start: "2026-10-26T07:00:00.000Z",
      end: "2026-11-25T08:00:00.000Z",
    });
  });
});

describe("peakRank", () => {
  test("the fraction at or below the value, ties counting as below", () => {
    expect(peakRank(3, [1, 2, 3, 4])).toBe(0.75);
    expect(peakRank(2, [2, 2, 3, 4])).toBe(0.5);
    expect(peakRank(4, [1, 2, 3, 4])).toBe(1);
    expect(peakRank(1, [1, 2, 3, 4])).toBe(0.25);
  });

  test("nothing to rank against with fewer than two", () => {
    expect(peakRank(3, [3])).toBeUndefined();
    expect(peakRank(3, [])).toBeUndefined();
  });
});

describe("swingHeights", () => {
  test("each rise and each fall", () => {
    const list = [extreme(0, 0, false), extreme(6, 3, true), extreme(12, 1, false)];
    expect(swingHeights(list)).toEqual([3, 2]);
  });

  test("a run of lows starts the next rise from the lower, and a run of highs the next fall from the higher", () => {
    const lows = [extreme(0, 1, false), extreme(3, 0.5, false), extreme(6, 3, true)];
    expect(swingHeights(lows)).toEqual([2.5]);
    const shallower = [extreme(0, 0.5, false), extreme(3, 1, false), extreme(6, 3, true)];
    expect(swingHeights(shallower)).toEqual([2.5]);
    const highs = [
      extreme(0, 0, false),
      extreme(3, 2, true),
      extreme(6, 3, true),
      extreme(9, 1, false),
    ];
    expect(swingHeights(highs)).toEqual([2, 2]);
  });

  test("an inverted pair is no swing", () => {
    expect(swingHeights([extreme(0, 2, false), extreme(6, 1, true)])).toEqual([]);
  });

  test("none without two turns", () => {
    expect(swingHeights([])).toEqual([]);
    expect(swingHeights([extreme(0, 1, true)])).toEqual([]);
  });
});

describe("rangeTile", () => {
  const list = [extreme(0, 0.5, false), extreme(6, 3, true), extreme(12, 1, false)];

  test("the swing from the turn behind to the one ahead, with its direction", () => {
    expect(rangeTile(list, t0 + 3 * H, undefined, "meters", "en-US")).toEqual({
      label: "Range",
      value: "2.50 m",
      caption: "low to high",
      marked: false,
    });
    expect(rangeTile(list, t0 + 9 * H, undefined, "feet", "en-US")).toMatchObject({
      value: "2.0 ft",
      caption: "high to low",
    });
  });

  test("a turn under the selection is the one behind", () => {
    expect(rangeTile(list, t0 + 6 * H, undefined, "meters")?.caption).toBe("high to low");
  });

  test("absent without a turn on each side", () => {
    expect(rangeTile(list, t0 - H, undefined, "meters")).toBeUndefined();
    expect(rangeTile(list, t0 + 12 * H, undefined, "meters")).toBeUndefined();
  });

  test("the fortnight's top tenth marks, and its biggest says so", () => {
    const at = t0 + 3 * H; // a 2.5 swing
    const tenth = [...Array(9).fill(1), 3]; // 2.5 ranks 0.9
    const below = [...Array(8).fill(1), 3, 3]; // 2.5 ranks 0.8
    expect(rangeTile(list, at, [...Array(9).fill(1), 2.5], "meters")).toMatchObject({
      caption: "the fortnight's biggest",
      marked: true,
    });
    expect(rangeTile(list, at, tenth, "meters")).toMatchObject({
      caption: "beyond normal here",
      marked: true,
    });
    // Only one bigger swing in twenty still isn't the biggest.
    const nearTop = [...Array(18).fill(1), 2.5, 3];
    expect(rangeTile(list, at, nearTop, "meters")?.caption).toBe("beyond normal here");
    expect(rangeTile(list, at, below, "meters")).toMatchObject({
      caption: "low to high",
      marked: false,
    });
  });
});

describe("nextMaxTile", () => {
  const events = [
    event(0, 0, "slack"),
    event(3, 4.2, "maxFlood"),
    event(6, 0, "slack"),
    event(9, -6.4, "maxEbb"),
    event(12, 0, "slack"),
  ];

  test("the first maximum after the selection, with its direction and time", () => {
    expect(nextMaxTile(events, t0 + H, undefined, tz, "en-US")).toEqual({
      label: "Next max",
      value: "4.2 kn",
      caption: "Flood at 8:00 PM",
      marked: false,
    });
    expect(nextMaxTile(events, t0 + 3 * H, undefined, tz, "en-US")).toMatchObject({
      value: "6.4 kn",
      caption: "Ebb at 2:00 AM",
    });
  });

  test("absent when no maximum follows", () => {
    expect(nextMaxTile(events, t0 + 9 * H, undefined, tz)).toBeUndefined();
  });

  test("ranks within its own direction", () => {
    // Every ebb runs harder, yet this is still the hardest flood.
    const fortnight = [
      ...[1, 2, 3, 4].map((s, i) => event(-100 + i, s, "maxFlood")),
      event(3, 4.2, "maxFlood"),
      ...[7, 8, 9].map((s, i) => event(-50 + i, -s, "maxEbb")),
    ];
    expect(nextMaxTile(events, t0 + H, fortnight, tz, "en-US")).toMatchObject({
      caption: "Hardest flood · 8:00 PM",
      marked: true,
    });
    // And the ebb, the harder direction, is ordinary among ebbs.
    expect(nextMaxTile(events, t0 + 4 * H, fortnight, tz, "en-US")).toMatchObject({
      caption: "Ebb at 2:00 AM",
      marked: false,
    });
    const softEbbs = [event(-50, -1, "maxEbb"), event(9, -6.4, "maxEbb")];
    expect(nextMaxTile(events, t0 + 4 * H, softEbbs, tz, "en-US")?.caption).toBe(
      "Hardest ebb · 2:00 AM",
    );
  });

  test("a top-tenth maximum is strong, and one below it plain", () => {
    const floods = (top: number) => [
      ...Array.from({ length: 9 }, (_, i) => event(-100 + i, 1, "maxFlood")),
      event(-10, top, "maxFlood"),
    ];
    expect(nextMaxTile(events, t0 + H, floods(5), tz, "en-US")?.caption).toBe(
      "Strong flood · 8:00 PM",
    );
    const nearTop = [...floods(5), ...floods(4.2)]; // 4.2 ranks 19 of 20
    expect(nextMaxTile(events, t0 + H, nearTop, tz, "en-US")?.caption).toBe(
      "Strong flood · 8:00 PM",
    );
    expect(
      nextMaxTile(events, t0 + H, [...floods(5), event(-11, 5, "maxFlood")], tz, "en-US"),
    ).toMatchObject({ caption: "Flood at 8:00 PM", marked: false });
  });

  test("maxSpeeds is one direction's unsigned speeds", () => {
    expect(maxSpeeds(events, "maxEbb")).toEqual([6.4]);
    expect(maxSpeeds(events, "maxFlood")).toEqual([4.2]);
  });
});
