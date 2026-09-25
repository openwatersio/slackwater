import { describe, test, expect } from "vitest";
import {
  createCurrentPredictor,
  createSubordinateCurrentPredictor,
  reduceCurrentEvents,
  currentSpeedAt,
  slackWindows,
  type CurrentEvent,
  type CurrentPoint,
  type CurrentPredictor,
} from "../src/index.js";
import { findSlacks } from "../src/harmonics/extremes.js";

/** M2 angular speed in radians per hour; period ≈ 12.4206 h. */
const M2_W = (Math.PI / 180) * 28.9841042;

const hours = (n: number) => n * 3600 * 1000;

describe("findSlacks", () => {
  // A pure single-M2 current: v(t) = cos(w·t + π/2). Slacks are the zeros of
  // cos, every half period T/2 ≈ 6.2103 h. Predicted independent of the engine.
  test("matches an analytic single-M2 current", () => {
    const params = [{ A: 1, w: M2_W, phi: Math.PI / 2 }];
    const slacks = findSlacks(0, 48, { startMs: 0, getParams: () => params });

    // ~48 h / (M2 half-period 6.2103 h) ≈ 7–8 zero crossings.
    expect(slacks.length).toBeGreaterThanOrEqual(7);
    expect(slacks.length).toBeLessThanOrEqual(9);
    for (const slack of slacks) {
      expect(Math.abs(slack.speed)).toBeLessThan(1e-3);
    }
    for (let i = 1; i < slacks.length; i++) {
      const gap = (slacks[i].time.getTime() - slacks[i - 1].time.getTime()) / hours(1);
      expect(gap).toBeWithin(6.2103, 0.1);
    }
  });

  test("returns nothing without constituents", () => {
    expect(findSlacks(0, 48, { startMs: 0, getParams: () => [] })).toEqual([]);
  });

  test("returns nothing for a constant offset alone", () => {
    // Z0 has speed 0: it shifts the level but produces no zero-crossings.
    const params = [{ A: 0.5, w: 0, phi: 0 }];
    expect(findSlacks(0, 48, { startMs: 0, getParams: () => params })).toEqual([]);
  });
});

describe("createCurrentPredictor", () => {
  // A reversing current from a couple of constituents. Assert only structural
  // invariants true for any correct reversing current — no external oracle.
  test("event structure is consistent", () => {
    const station = createCurrentPredictor(
      [
        { name: "M2", amplitude: 2.0, phase: 40 },
        { name: "K1", amplitude: 0.5, phase: 200 },
        { name: "NOT_A_CONSTITUENT", amplitude: 9, phase: 0 },
      ],
      { floodDirection: 120, ebbDirection: 300 },
    );
    const start = new Date("2026-03-01T00:00:00Z");
    const end = new Date("2026-03-02T00:00:00Z");

    const timeline = station.getTimelinePrediction({ start, end });
    expect(timeline.length).toBeGreaterThan(0);
    const maxAbs = Math.max(...timeline.map((p) => Math.abs(p.speed)));
    expect(maxAbs).toBeGreaterThan(1.0);

    const events = station.getEventsPrediction({ start, end });
    const maxima = events.filter((e) => e.kind !== "slack");
    expect(maxima.some((e) => e.kind === "maxFlood")).toBe(true);
    expect(maxima.some((e) => e.kind === "maxEbb")).toBe(true);
    for (const m of maxima) {
      if (m.kind === "maxFlood") {
        expect(m.speed).toBeGreaterThan(0);
        expect(m.direction).toBe(120);
      } else {
        expect(m.speed).toBeLessThan(0);
        expect(m.direction).toBe(300);
      }
    }

    const slacks = events.filter((e) => e.kind === "slack");
    expect(slacks.length).toBeGreaterThan(0);
    for (const s of slacks) {
      expect(Math.abs(s.speed)).toBeLessThan(1e-3);
      expect(s.direction).toBeUndefined();
    }

    for (let i = 1; i < events.length; i++) {
      expect(events[i].time.getTime()).toBeGreaterThanOrEqual(events[i - 1].time.getTime());
    }
  });

  test("events are trimmed to the requested days", () => {
    const station = createCurrentPredictor([{ name: "M2", amplitude: 2.0, phase: 40 }], {
      floodDirection: 100,
      ebbDirection: 280,
    });
    // A span inside one UTC day returns that whole day's events.
    const events = station.getEventsPrediction({
      start: new Date("2026-03-01T10:00:00Z"),
      end: new Date("2026-03-01T11:00:00Z"),
    });
    expect(events.length).toBeGreaterThan(4);
    for (const e of events) {
      expect(e.time.getTime()).toBeGreaterThanOrEqual(Date.parse("2026-03-01T00:00:00Z"));
      expect(e.time.getTime()).toBeLessThan(Date.parse("2026-03-02T00:00:00Z"));
    }
  });

  test("rejects an inverted time span", () => {
    const station = createCurrentPredictor([{ name: "M2", amplitude: 1, phase: 0 }], {
      floodDirection: 0,
      ebbDirection: 180,
    });
    const start = new Date("2026-03-02T00:00:00Z");
    const end = new Date("2026-03-01T00:00:00Z");
    expect(() => station.getEventsPrediction({ start, end })).toThrow(
      "Start time must be before end time",
    );
    expect(() => station.getTimelinePrediction({ start, end })).toThrow(
      "Start time must be before end time",
    );
  });
});

describe("createSubordinateCurrentPredictor", () => {
  const start = new Date("2026-03-01T00:00:00Z");
  const end = new Date("2026-03-02T00:00:00Z");
  const reference = createCurrentPredictor([{ name: "M2", amplitude: 2.0, phase: 40 }], {
    floodDirection: 100,
    ebbDirection: 280,
  });
  const sub = createSubordinateCurrentPredictor(reference, {
    slackBeforeFloodOffset: 600,
    slackBeforeEbbOffset: -900,
    floodTimeOffset: -1800,
    ebbTimeOffset: 1200,
    floodSpeedRatio: 1.5,
    ebbSpeedRatio: 0.8,
    floodDirection: 110,
    ebbDirection: 290,
  });

  // NOAA's subordinate reduction: two slack offsets (before-flood, before-ebb),
  // two peak time offsets, two speed ratios. A slack is shifted by the offset
  // that matches the phase it precedes (its next non-slack event's kind).
  test("shifts and scales the reference events", () => {
    const subEvents = sub.getEventsPrediction({ start, end });
    expect(subEvents.length).toBeGreaterThan(0);

    // Sign-consistent labels; slacks are exactly zero.
    for (const e of subEvents) {
      if (e.kind === "maxFlood") expect(e.speed).toBeGreaterThan(0);
      if (e.kind === "maxEbb") expect(e.speed).toBeLessThan(0);
      if (e.kind === "slack") expect(e.speed).toBe(0);
    }

    // Flood peaks: reconstruct expected time/speed from the reference (undo
    // the -1800 s flood time offset, expect speed × 1.5).
    const refFlood = reference
      .getEventsPrediction({
        start: new Date(start.getTime() - hours(2)),
        end: new Date(end.getTime() + hours(2)),
      })
      .filter((e) => e.kind === "maxFlood");
    const subFlood = subEvents.filter((e) => e.kind === "maxFlood");
    expect(subFlood.length).toBeGreaterThan(0);
    for (const sf of subFlood) {
      expect(sf.direction).toBe(110);
      const orig = sf.time.getTime() + 1800 * 1000;
      const r = refFlood.reduce((a, b) =>
        Math.abs(a.time.getTime() - orig) < Math.abs(b.time.getTime() - orig) ? a : b,
      );
      expect(Math.abs(r.time.getTime() - orig)).toBeLessThan(2000);
      expect(sf.speed).toBeWithin(r.speed * 1.5, 1e-3);
    }
  });

  test("rejects an inverted time span", () => {
    expect(() => sub.getEventsPrediction({ start: end, end: start })).toThrow(
      "Start time must be before end time",
    );
    expect(() => sub.getTimelinePrediction({ start: end, end: start })).toThrow(
      "Start time must be before end time",
    );
  });

  test("holds flat when the reference produces too few events", () => {
    const still: CurrentPredictor = {
      floodDirection: 0,
      ebbDirection: 180,
      getEventsPrediction: () => [],
      getTimelinePrediction: () => [],
    };
    const subOfStill = createSubordinateCurrentPredictor(still, {
      slackBeforeFloodOffset: 0,
      slackBeforeEbbOffset: 0,
      floodTimeOffset: 0,
      ebbTimeOffset: 0,
      floodSpeedRatio: 1,
      ebbSpeedRatio: 1,
      floodDirection: 0,
      ebbDirection: 180,
    });
    const timeline = subOfStill.getTimelinePrediction({
      start,
      end: new Date(start.getTime() + hours(1)),
    });
    expect(timeline.every((p) => p.speed === 0)).toBe(true);

    const one: CurrentPredictor = {
      ...still,
      getEventsPrediction: () => [{ time: start, speed: 1.25, kind: "maxFlood" }],
    };
    const subOfOne = createSubordinateCurrentPredictor(one, {
      slackBeforeFloodOffset: 0,
      slackBeforeEbbOffset: 0,
      floodTimeOffset: 0,
      ebbTimeOffset: 0,
      floodSpeedRatio: 1,
      ebbSpeedRatio: 1,
      floodDirection: 0,
      ebbDirection: 180,
    });
    const held = subOfOne.getTimelinePrediction({
      start,
      end: new Date(start.getTime() + hours(1)),
    });
    expect(held.every((p) => p.speed === 1.25)).toBe(true);
  });
});

describe("reduceCurrentEvents", () => {
  const offsets = {
    slackBeforeFloodOffset: 600,
    slackBeforeEbbOffset: -900,
    floodTimeOffset: -1800,
    ebbTimeOffset: 1200,
    floodSpeedRatio: 1.5,
    ebbSpeedRatio: 0.8,
    floodDirection: 110,
    ebbDirection: 290,
  };
  const at = (h: number) => new Date(hours(h));

  test("a slack takes the offset of the phase it precedes", () => {
    const reduced = reduceCurrentEvents(
      [
        { time: at(0), speed: 0, kind: "slack" },
        { time: at(3), speed: 2, kind: "maxFlood" },
        { time: at(6), speed: 0, kind: "slack" },
        { time: at(9), speed: -1, kind: "maxEbb" },
        { time: at(12), speed: 0, kind: "slack" },
      ],
      offsets,
    );
    expect(reduced.map((e) => e.kind)).toEqual(["slack", "maxFlood", "slack", "maxEbb", "slack"]);
    // Slack before flood: +600 s. Slack before ebb: -900 s.
    expect(reduced[0].time).toEqual(new Date(at(0).getTime() + 600_000));
    expect(reduced[2].time).toEqual(new Date(at(6).getTime() - 900_000));
    // A trailing slack with no following phase defaults to the flood offset.
    expect(reduced[4].time).toEqual(new Date(at(12).getTime() + 600_000));
    // Peaks shift and scale per phase, carrying the subordinate's directions.
    expect(reduced[1]).toEqual({
      time: new Date(at(3).getTime() - 1800_000),
      speed: 3,
      kind: "maxFlood",
      direction: 110,
    });
    expect(reduced[3]).toEqual({
      time: new Date(at(9).getTime() + 1200_000),
      speed: -0.8,
      kind: "maxEbb",
      direction: 290,
    });
  });

  test("re-sorts when unequal offsets reorder neighbours", () => {
    const reduced = reduceCurrentEvents(
      [
        { time: at(0), speed: 0, kind: "slack" }, // precedes flood: +1800 s
        { time: at(0.25), speed: 2, kind: "maxFlood" }, // -1800 s
      ],
      { ...offsets, slackBeforeFloodOffset: 1800, floodTimeOffset: -1800 },
    );
    expect(reduced.map((e) => e.kind)).toEqual(["maxFlood", "slack"]);
  });
});

describe("currentSpeedAt", () => {
  test("interpolates a half-cosine between bracketing events", () => {
    const events: CurrentEvent[] = [
      { time: new Date(0), speed: 2, kind: "maxFlood" },
      { time: new Date(hours(3)), speed: -1, kind: "maxEbb" },
    ];
    expect(currentSpeedAt(events, new Date(0))).toBeWithin(2, 1e-9);
    // Midpoint of the half-cosine is the mean of the knots.
    expect(currentSpeedAt(events, new Date(hours(1.5)))).toBeWithin(0.5, 1e-9);
    expect(currentSpeedAt(events, new Date(hours(3)))).toBeWithin(-1, 1e-9);
    // Outside the bracketed span the nearest knot's value holds flat.
    expect(currentSpeedAt(events, new Date(hours(4)))).toBeWithin(-1, 1e-9);
  });

  test("holds flat with fewer than two events", () => {
    expect(currentSpeedAt([], new Date(0))).toBe(0);
    expect(
      currentSpeedAt([{ time: new Date(0), speed: 1.5, kind: "maxFlood" }], new Date(hours(5))),
    ).toBe(1.5);
  });
});

describe("slackWindows", () => {
  const sample = (h: number, speed: number): CurrentPoint => ({
    time: new Date(hours(h)),
    hour: h,
    speed,
  });

  test("interpolates the band crossings around a reversal", () => {
    const timeline = [sample(0, 2), sample(1, 1), sample(2, -1), sample(3, -2)];
    const windows = slackWindows(timeline, 1);
    expect(windows.length).toBe(1);
    // |speed| crosses 1 kn exactly at the knots here.
    expect(windows[0].start).toEqual(new Date(hours(1)));
    expect(windows[0].end).toEqual(new Date(hours(2)));

    // Crossings between samples are interpolated, not snapped to samples.
    const between = slackWindows([sample(0, 2), sample(2, 0), sample(4, -2)], 1);
    expect(between.length).toBe(1);
    expect(between[0].start).toEqual(new Date(hours(1)));
    expect(between[0].end).toEqual(new Date(hours(3)));
  });

  test("a lull that never reverses is not a window", () => {
    // Dips under the threshold and builds back the way it came: weak water.
    const windows = slackWindows([sample(0, 2), sample(1, 0.5), sample(2, 2)], 1);
    expect(windows).toEqual([]);

    // Touching exactly zero without reversing is still a lull.
    expect(slackWindows([sample(0, 2), sample(1, 0), sample(2, 2)], 1)).toEqual([]);
  });

  test("a reversal landing on an exact-zero sample still counts", () => {
    const windows = slackWindows([sample(0, 2), sample(1, 0), sample(2, -2)], 1);
    expect(windows.length).toBe(1);
  });

  test("a sub-threshold blip between two reversals stays one run", () => {
    const timeline = [sample(0, 2), sample(1, 0.5), sample(2, -0.5), sample(3, 0.5), sample(4, 2)];
    const windows = slackWindows(timeline, 1);
    expect(windows.length).toBe(1);
  });

  test("a window open at the frame edge ends at the edge", () => {
    const timeline = [sample(0, 2), sample(1, 0.5), sample(2, -0.5)];
    const windows = slackWindows(timeline, 1);
    expect(windows.length).toBe(1);
    expect(windows[0].end).toEqual(timeline[2].time);

    // A frame that starts inside the band opens at the first sample.
    const openStart = slackWindows([sample(0, 0.5), sample(1, -0.5), sample(2, -2)], 1);
    expect(openStart.length).toBe(1);
    expect(openStart[0].start).toEqual(new Date(0));
  });

  test("an empty timeline has no windows", () => {
    expect(slackWindows([], 1)).toEqual([]);
  });
});
