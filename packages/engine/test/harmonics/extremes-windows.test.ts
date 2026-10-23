import { describe, expect, it } from "vitest";
import { createTidePredictor } from "../../src/index.js";
import { findExtremes } from "../../src/harmonics/extremes.js";
import { createParamsFactory } from "../../src/harmonics/params.js";
import models from "../../src/constituents/index.js";
import victoria from "../../../../fixtures/prediction-victoria.json";
import midnight from "../../../../fixtures/extremes-midnight.json";

const HOUR = 3_600_000;
const t0 = Date.UTC(2026, 7, 1, 20);

// A gauge whose every turn is a few millimetres, like the Great Lakes and the
// upper St Lawrence: runs of turns below the 1 cm filter last for days.
const subCentimetre = createTidePredictor([
  { name: "M2", amplitude: 0.002, phase: 40 },
  { name: "K1", amplitude: 0.0025, phase: 110 },
  { name: "O1", amplitude: 0.0015, phase: 300 },
  { name: "S2", amplitude: 0.001, phase: 75 },
]);
const victoriaPredictor = createTidePredictor(victoria.constituents);

const key = (e: { time: Date; high: boolean }) => `${e.time.getTime()}:${e.high ? "H" : "L"}`;

function extremes(predictor: typeof subCentimetre, startMs: number, hours: number) {
  return predictor
    .getExtremesPrediction({ start: new Date(startMs), end: new Date(startMs + hours * HOUR) })
    .map(key);
}

describe("extremes do not depend on the window asked for", () => {
  it.each([
    ["a gauge whose turns are all below the filter", subCentimetre],
    ["Victoria", victoriaPredictor],
  ])("at %s, overlapping windows report the same turns where they overlap", (_, predictor) => {
    const long = new Set(extremes(predictor, t0 - 24 * HOUR, 120));
    expect(long.size, "turns to compare").toBeGreaterThan(1);
    for (const offset of [0, 1, 7, 13, 19]) {
      for (const hours of [13, 30, 48]) {
        const start = t0 + offset * HOUR;
        const inWindow = [...long].filter((k) => {
          const t = Number(k.split(":")[0]);
          return t >= start && t <= start + hours * HOUR;
        });
        expect(extremes(predictor, start, hours), `${hours} h from +${offset} h`).toEqual(inWindow);
      }
    }
  });
});

describe("findExtremes does not depend on where its window is anchored", () => {
  // A current's flood-axis velocity: findExtremes finds its maxima as it finds a tide's extremes.
  const constituents = [
    { name: "M2", amplitude: 1.2, phase: 40 },
    { name: "K1", amplitude: 0.6, phase: 110 },
    { name: "M4", amplitude: 0.2, phase: 300 },
  ].map((c) => ({ ...c, phase: (c.phase * Math.PI) / 180 }));
  const paramsFrom = (dayStart: Date) =>
    createParamsFactory({
      constituents,
      constituentModels: models,
      start: dayStart,
      endHour: 24,
    })();
  const between = (startMs: number, hours: number) =>
    findExtremes(0, hours, { startMs, prominenceThreshold: 0.01, paramsFrom }).map(key);

  it("reports the same maxima from windows anchored at different instants", () => {
    const long = between(t0 - 24 * HOUR, 120);
    expect(long.length).toBeGreaterThan(1);
    for (const offset of [0, 7, 19]) {
      for (const hours of [13, 48]) {
        const start = t0 + offset * HOUR;
        const inWindow = long.filter((k) => {
          const t = Number(k.split(":")[0]);
          return t >= start && t <= start + hours * HOUR;
        });
        expect(between(start, hours), `${hours} h from +${offset} h`).toEqual(inWindow);
      }
    }
  });
});

describe("a tide of the annual cycle alone", () => {
  const annual = createTidePredictor([{ name: "Sa", amplitude: 1, phase: 40 }]);
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2027-01-01T00:00:00Z");

  it("has a high and a low a year, though its turns are months apart", () => {
    const year = annual.getExtremesPrediction({ start, end });
    expect(year.map((e) => e.high)).toEqual([true, false]);
  });

  it("draws a subordinate curve from raw turning points when every turn is below the threshold", () => {
    // 6 mm from high to low: nothing clears 1 cm, so the timeline falls back to raw turns.
    const faint = createTidePredictor([{ name: "Sa", amplitude: 0.003, phase: 40 }]);
    expect(faint.getExtremesPrediction({ start, end })).toEqual([]);
    const identity = {
      height: { high: 1, low: 1, type: "ratio" as const },
      time: { high: 0, low: 0 },
    };
    const timeline = faint.getTimelinePrediction({
      start,
      end,
      timeFidelity: 86_400,
      offsets: identity,
    });
    expect(timeline).toHaveLength(366);
  });
});

describe("a subordinate of a reference whose kept extremes are days apart", () => {
  it.each([
    [
      "identity offsets",
      { height: { high: 1, low: 1, type: "ratio" as const }, time: { high: 0, low: 0 } },
    ],
    ["height offsets alone", { height: { high: 1, low: 1, type: "ratio" as const } }],
  ])("follows the reference curve with %s, wherever the window falls", (_, offsets) => {
    for (let day = 0; day < 20; day++) {
      const start = new Date(t0 + day * 24 * HOUR);
      const end = new Date(start.getTime() + 24 * HOUR);
      const reference = subCentimetre.getTimelinePrediction({ start, end });
      const subordinate = subCentimetre.getTimelinePrediction({ start, end, offsets });
      subordinate.forEach((point, i) => expect(point.level).toBeCloseTo(reference[i].level, 9));
    }
  });
});

describe("a turn on UTC midnight", () => {
  // Cambridge, MD: each day's parameters put the low of 26 July on the other side of
  // midnight, a second apart, so neither day's own search sees it change sign.
  const cambridge = createTidePredictor(midnight.constituents);
  const start = new Date(midnight.start);
  const end = new Date(midnight.end);

  it("is found once, and the high before it is kept", () => {
    const found = cambridge.getExtremesPrediction({ start, end }).map(key);
    const near = (iso: string, kind: "H" | "L") =>
      found.filter(
        (k) => k.endsWith(kind) && Math.abs(Number(k.split(":")[0]) - Date.parse(iso)) < 5 * 60_000,
      );
    expect(near("2026-07-26T00:00:00Z", "L")).toHaveLength(1);
    expect(near("2026-07-25T17:50:00Z", "H")).toHaveLength(1);
  });

  it("matches every turn of the curve sampled each minute", () => {
    const levels = cambridge.getTimelinePrediction({ start, end, timeFidelity: 60 });
    let turns = 0;
    for (let i = 2; i < levels.length; i++) {
      const before = levels[i - 1].level - levels[i - 2].level;
      const after = levels[i].level - levels[i - 1].level;
      if (before * after < 0) turns++;
    }
    // Every turn here clears the 1 cm threshold.
    expect(cambridge.getExtremesPrediction({ start, end })).toHaveLength(turns);
  });
});

describe("a turn the two days' parameters put either side of midnight", () => {
  // One wave whose high falls at midnight on every day but two: the day before
  // puts it `before` hours from midnight and the day after `after` hours from it.
  const midnightMs = Date.UTC(2026, 6, 26);
  const w = (2 * Math.PI) / 12.42;
  const second = 1 / 3600;
  const wave = (before: number, after: number) => (dayStart: Date) => {
    const fromMidnight = (midnightMs - dayStart.getTime()) / HOUR;
    const shift = fromMidnight === 24 ? before : fromMidnight === 0 ? after : 0;
    return () => [{ A: 1, w, phi: -w * (fromMidnight + shift) }];
  };
  const highs = (before: number, after: number) =>
    findExtremes(0, 12, {
      startMs: midnightMs - 6 * HOUR,
      prominenceThreshold: 0,
      paramsFrom: wave(before, after),
    }).filter((e) => e.high);

  it.each([
    ["each day finds it on its own side", -second, second],
    ["neither day finds it on its own side", second, -second],
  ])("is found once when %s", (_, before, after) => {
    const found = highs(before, after);
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0].time.getTime() - midnightMs)).toBeLessThan(2000);
  });
});
