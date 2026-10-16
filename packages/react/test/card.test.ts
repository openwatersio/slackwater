import { describe, expect, test } from "vitest";
import type { Extreme, StationSummary } from "../src/types.js";
import {
  CARD_BACK_MS,
  CARD_FORWARD_MS,
  SEARCH_LIMIT,
  cardDomain,
  cardRange,
  formatNm,
  mergeNearby,
  rankSearch,
  readCurrentCard,
  readTideCard,
  readsSlack,
  valueAt,
  hangToward,
  thinAxisTimes,
} from "../src/utils/card.js";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-15T12:00:00Z");
const at = (h: number) => new Date(T0 + h * HOUR);

function station(id: string, kind: StationSummary["kind"], extra: Partial<StationSummary> = {}) {
  return {
    id,
    name: id,
    latitude: 0,
    longitude: 0,
    country: "US",
    continent: "Americas",
    timezone: "UTC",
    type: "reference" as const,
    kind,
    ...extra,
  };
}

describe("cardRange", () => {
  test("loads the card's span from the start of the hour, with extremes 30 h on", () => {
    const range = cardRange(T0 + 25 * 60_000);
    expect(Date.parse(range.timeline.start)).toBe(T0 - CARD_BACK_MS);
    expect(Date.parse(range.timeline.end)).toBe(T0 + HOUR + CARD_FORWARD_MS);
    expect(range.extremes.start).toBe(range.timeline.start);
    expect(Date.parse(range.extremes.end)).toBe(T0 + 31 * HOUR);
  });

  test("is the same query for the whole hour", () => {
    expect(cardRange(T0)).toEqual(cardRange(T0 + HOUR - 1));
    expect(cardRange(T0 + HOUR)).not.toEqual(cardRange(T0));
  });
});

describe("cardDomain", () => {
  const points = [-10, 1, 2, 3, 10].map((value, i) => ({ time: i, value }));

  test("fits the samples in view, padded a quarter of their range each way", () => {
    expect(cardDomain(points, 1, 3, false)).toEqual({ lo: 0.5, hi: 3.5, lowest: 1 });
  });

  test("keeps zero in a current's range", () => {
    expect(cardDomain(points, 1, 3, true)).toEqual({ lo: -0.75, hi: 3.75, lowest: 0 });
  });

  test("never collapses a flat curve", () => {
    const { lo, hi } = cardDomain([{ time: 0, value: 2 }], 0, 1, false);
    expect(hi - lo).toBeGreaterThan(0);
  });
});

describe("valueAt", () => {
  const points = [
    { time: 0, value: 0 },
    { time: 10, value: 10 },
  ];

  test("interpolates between samples and holds the ends outside them", () => {
    expect(valueAt(points, 4)).toBe(4);
    expect(valueAt(points, -5)).toBe(0);
    expect(valueAt(points, 15)).toBe(10);
  });
});

describe("readTideCard", () => {
  const timeline = [0, 1, 2].map((h) => ({ time: at(h), level: h }));
  const turn = (h: number, high: boolean): Extreme => ({
    time: at(h),
    level: 0,
    high,
    low: !high,
    label: high ? "High" : "Low",
  });

  test("reads the height now and the way to the next turn", () => {
    expect(readTideCard(timeline, [turn(0.5, false), turn(3, true)], T0 + HOUR)).toEqual({
      level: 1,
      rising: true,
    });
    expect(readTideCard(timeline, [turn(3, false)], T0 + HOUR)?.rising).toBe(false);
  });

  test("at a turn, already heads for the next one", () => {
    expect(readTideCard(timeline, [turn(1, true), turn(7, false)], T0 + HOUR)?.rising).toBe(false);
  });

  test("rises when no later turn is loaded, and reads nothing outside the samples", () => {
    expect(readTideCard(timeline, [], T0)?.rising).toBe(true);
    expect(readTideCard(timeline, [], T0 + 5 * HOUR)).toBeUndefined();
  });
});

describe("readsSlack", () => {
  const window = { start: at(1), end: at(2) };
  const bare = { start: at(5), end: at(5) };

  test("holds inside a window up to but not at its closing", () => {
    expect(readsSlack([window], T0 + HOUR)).toBe(true);
    expect(readsSlack([window], T0 + 1.5 * HOUR)).toBe(true);
    expect(readsSlack([window], T0 + 2 * HOUR)).toBe(false);
    expect(readsSlack([window], T0 + HOUR - 1)).toBe(false);
  });

  test("holds within a second of a windowless slack", () => {
    expect(readsSlack([bare], T0 + 5 * HOUR + 999)).toBe(true);
    expect(readsSlack([bare], T0 + 5 * HOUR - 1000)).toBe(false);
  });
});

describe("readCurrentCard", () => {
  const timeline = [
    { time: at(0), speed: 2 },
    { time: at(1), speed: -2 },
  ];
  const directions = { flood: 90, ebb: 270 };

  test("sets toward flood or ebb by the sign of the speed", () => {
    expect(readCurrentCard(timeline, [], directions, T0)).toEqual({
      speed: 2,
      slack: false,
      direction: 90,
    });
    expect(readCurrentCard(timeline, [], directions, T0 + HOUR)?.direction).toBe(270);
  });

  test("reads slack only on a slack mark, whatever the speed", () => {
    const runs = [{ start: at(0), end: at(0.25) }];
    expect(readCurrentCard(timeline, runs, directions, T0)?.slack).toBe(true);
    expect(readCurrentCard(timeline, [], directions, T0 + HOUR / 2)?.slack).toBe(false);
  });

  test("leaves the set out when the station has none", () => {
    expect(readCurrentCard(timeline, [], {}, T0)).not.toHaveProperty("direction");
    expect(readCurrentCard(timeline, [], {}, T0 + 2 * HOUR)).toBeUndefined();
  });
});

describe("formatNm", () => {
  test("one decimal under 10 nm, whole miles from 10", () => {
    expect(formatNm(2.2224, "en-US")).toBe("1.2 nm");
    expect(formatNm(18.3, "en-US")).toBe("9.9 nm");
    expect(formatNm(25.928, "en-US")).toBe("14 nm");
    expect(formatNm(20000, "en-US")).toBe("10799 nm");
  });
});

describe("mergeNearby", () => {
  const tides = [station("t1", "tide", { distance: 3 }), station("t2", "tide", { distance: 9 })];
  const currents = [
    station("c1", "current", { distance: 1 }),
    station("t1", "current", { distance: 5 }),
  ];

  test("puts both kinds nearest first, up to the maximum", () => {
    expect(mergeNearby([tides, currents], 3).map((s) => `${s.kind}:${s.id}`)).toEqual([
      "current:c1",
      "tide:t1",
      "current:t1",
    ]);
  });

  test("leaves out the station it measures from, matching its kind", () => {
    const merged = mergeNearby([tides, currents], 10, { id: "t1", kind: "tide" });
    expect(merged.map((s) => `${s.kind}:${s.id}`)).toEqual(["current:c1", "current:t1", "tide:t2"]);
  });

  test("breaks a tie on id", () => {
    const tied = [station("b", "tide", { distance: 1 }), station("a", "current", { distance: 1 })];
    expect(mergeNearby([tied], 2).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("rankSearch", () => {
  const tides = [
    station("t-region", "tide", { name: "Cornet Bay", region: "Deception" }),
    station("t-name", "tide", { name: "Deception Pass St. Park" }),
    station("t-other", "tide", { name: "Yokeko Point" }),
  ];
  const currents = [
    station("c-name", "current", { name: "Point Deception" }),
    station("c-name2", "current", { name: "Deception Pass (Narrows)" }),
  ];

  test("ranks a name match, then a region match, then the rest", () => {
    expect(rankSearch(" deception ", [tides, currents]).map((s) => s.id)).toEqual([
      "c-name",
      "t-name",
      "c-name2",
      "t-region",
      "t-other",
    ]);
  });

  test("alternates the kinds where each list ranks a station the same", () => {
    const a = [station("a1", "tide"), station("a2", "tide")];
    const b = [station("b1", "current"), station("b2", "current")];
    expect(rankSearch("zzz", [a, b]).map((s) => s.id)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("stops at the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => station(`s${i}`, "tide"));
    expect(rankSearch("s", [many, many]).length).toBe(SEARCH_LIMIT);
  });
});

describe("hangToward", () => {
  test("hangs toward the plot middle while the reading fits", () => {
    expect(hangToward(80, false, 108)).toBe(-1);
    expect(hangToward(20, true, 108)).toBe(1);
  });
  test("flips to the open side when the reading would leave the graph", () => {
    // A low near the top would run into the card's name and region.
    expect(hangToward(30, false, 108)).toBe(1);
    // A high near the bottom would run into the axis times.
    expect(hangToward(80, true, 108)).toBe(-1);
  });
});

test("thinAxisTimes drops times near the edges and any closer than 48 px to the last kept", () => {
  const x = (t: number) => t;
  expect(thinAxisTimes([10, 100, 130, 160, 300, 390], x, 400)).toEqual([100, 160, 300]);
});
