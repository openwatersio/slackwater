import { describe, expect, test } from "vitest";
import {
  COMPASS_POINTS,
  SPOKEN_COMPASS_POINTS,
  compass16,
  compassIndex,
  maxSpeeds,
  readCurrent,
  slackRuns,
  slackWindowAround,
  speedAt,
  vectorAt,
  type CurrentEvent,
} from "../../src/index.js";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 10);
// One sine cycle per 12 h at 3 kn, sampled every 10 minutes for a day.
const timeline = Array.from({ length: 145 }, (_, i) => ({
  time: new Date(t0 + i * 600_000),
  speed: 3 * Math.sin((2 * Math.PI * i) / 72),
}));
const events: CurrentEvent[] = [
  { time: new Date(t0 + 3 * H), speed: 3, kind: "maxFlood", direction: 45 },
  { time: new Date(t0 + 6 * H), speed: 0, kind: "slack" },
  { time: new Date(t0 + 9 * H), speed: -3, kind: "maxEbb", direction: 225 },
];
const slackAt = (t: number): CurrentEvent => ({ time: new Date(t), speed: 0, kind: "slack" });
const M = 60_000;
/** Ten-minute samples from t0 with the given speeds. */
const series = (speeds: number[]) =>
  speeds.map((speed, i) => ({ time: new Date(t0 + i * 10 * M), speed }));

test("uses a nonreciprocal published ebb bearing when vector data is unavailable", () => {
  const reading = readCurrent(new Date(t0 + 8 * H), timeline, events, { flood: 45, ebb: 200 })!;
  expect(reading.direction).toBe(200);
  expect(SPOKEN_COMPASS_POINTS[compassIndex(reading.direction!)]).toBe("south-southwest");
});

describe("vector readings", () => {
  const point = (h: number, speed: number, magnitude: number, direction?: number) => ({
    time: new Date(t0 + h * H),
    speed,
    magnitude,
    ...(direction !== undefined && { direction }),
  });
  test("keeps crossflow and its set at a flood/ebb zero", () => {
    const tl = [point(0, 0, 2, 90), point(1, -1, 2, 120)];
    const reading = readCurrent(new Date(t0), tl, [slackAt(t0)], { flood: 0, ebb: 180 })!;
    expect(reading).toMatchObject({ state: "Slack", speed: 0, magnitude: 2, direction: 90 });
  });
  test("interpolates vectors through north rather than turning south", () => {
    const reading = readCurrent(
      new Date(t0 + H / 2),
      [point(0, 1, 1, 350), point(1, 1, 1, 10)],
      [],
      {},
    )!;
    expect(reading.magnitude).toBeCloseTo(0.984807753);
    expect(reading.direction).toBeCloseTo(0);
  });
  test("opposite vectors cancel without inventing a set", () => {
    const reading = readCurrent(
      new Date(t0 + H / 2),
      [point(0, 1, 1, 90), point(1, -1, 1, 270)],
      [],
      {},
    )!;
    expect(reading.magnitude).toBeCloseTo(0);
    expect(reading).not.toHaveProperty("direction");
  });
  test("interpolates from a zero vector with no bearing", () => {
    const tl = [point(0, 0, 0), point(1, 1, 1, 90)];
    expect(readCurrent(new Date(t0), tl, [], {})).toMatchObject({ magnitude: 0 });
    expect(readCurrent(new Date(t0), tl, [], {})).not.toHaveProperty("direction");
    expect(readCurrent(new Date(t0 + H / 2), tl, [], {})).toMatchObject({
      magnitude: 0.5,
      direction: 90,
    });
  });
  test("interpolates toward a zero vector with no bearing", () => {
    const tl = [point(0, 1, 2, 90), point(1, 0, 0)];
    expect(readCurrent(new Date(t0 + H / 2), tl, [], {})).toMatchObject({
      speed: 0.5,
      magnitude: 1,
      direction: 90,
    });
    expect(readCurrent(new Date(t0 + H), tl, [], {})).not.toHaveProperty("direction");
  });
  test("preserves speed without a known set, including a known endpoint beside an unknown one", () => {
    const tl = [point(0, 1, 2, 90), point(1, 1, 3)];
    expect(readCurrent(new Date(t0), tl, [], {})).toMatchObject({ magnitude: 2, direction: 90 });
    expect(readCurrent(new Date(t0 + H / 2), tl, [], {})).toMatchObject({ magnitude: 2.5 });
    expect(readCurrent(new Date(t0 + H / 2), tl, [], {})).not.toHaveProperty("direction");
    expect(readCurrent(new Date(t0 + H), tl, [], {})).not.toHaveProperty("direction");
  });
  test.each([1, -1])(
    "keeps scalar phase bearings through a nonreciprocal reversal, direction %s",
    (sign) => {
      const tl =
        sign > 0
          ? [point(0, 0.3, 0.3, 45), point(1, -0.3, 0.3, 200)]
          : [point(0, -0.3, 0.3, 200), point(1, 0.3, 0.3, 45)];
      const zero = readCurrent(new Date(t0 + H / 2), tl, [], { flood: 45, ebb: 200 })!;
      expect(zero.magnitude).toBe(0);
      expect(zero).not.toHaveProperty("direction");
      const before = readCurrent(new Date(t0 + H * 0.4), tl, [], { flood: 45, ebb: 200 })!;
      expect(before.magnitude).toBeCloseTo(0.06);
      expect(before.direction).toBe(sign > 0 ? 45 : 200);
      const after = readCurrent(new Date(t0 + H * 0.6), tl, [], { flood: 45, ebb: 200 })!;
      expect(after.magnitude).toBeCloseTo(0.06);
      expect(after.direction).toBe(sign > 0 ? 200 : 45);
    },
  );

  test("falls back to absolute signed speed for older sources", () => {
    expect(
      readCurrent(new Date(t0 + 8 * H), timeline, events, { ebb: 200 })?.magnitude,
    ).toBeCloseTo(2.598076211353316);
    const zero = readCurrent(new Date(t0 + 6 * H), timeline, events, { flood: 45, ebb: 225 })!;
    expect(zero.magnitude).toBeCloseTo(0);
    expect(zero).not.toHaveProperty("direction");
  });

  test("vectorAt is the reading's vector and undefined outside the series", () => {
    const tl = [point(0, 1, 1, 350), point(1, 1, 1, 10)];
    expect(vectorAt(tl, new Date(t0 + H / 2), {})).toEqual({
      magnitude: expect.closeTo(0.984807753),
      direction: expect.closeTo(0),
    });
    expect(vectorAt(tl, new Date(t0 - 1), {})).toBeUndefined();
    expect(vectorAt(tl, new Date(t0 + H + 1), {})).toBeUndefined();
    expect(vectorAt([], new Date(t0), {})).toBeUndefined();
  });
});

test("compass16", () => {
  expect(compass16(0)).toBe("N");
  expect(compass16(349)).toBe("N");
  expect(compass16(22.5)).toBe("NNE");
  expect(compass16(225)).toBe("SW");
  expect(compass16(-90)).toBe("W");
});

test("spoken compass points pair with the abbreviations", () => {
  expect(SPOKEN_COMPASS_POINTS[compassIndex(22.5)]).toBe("north-northeast");
  expect(COMPASS_POINTS).toHaveLength(16);
});

describe("speedAt", () => {
  test("interpolates and is undefined outside the series", () => {
    expect(speedAt(timeline, new Date(t0 + 300_000))).toBeCloseTo(
      (timeline[0].speed + timeline[1].speed) / 2,
    );
    expect(speedAt(timeline, new Date(t0 - 1))).toBeUndefined();
    expect(speedAt([], new Date(t0))).toBeUndefined();
  });
  test("handles duplicate samples", () => {
    const flat = [timeline[0], timeline[0]];
    expect(speedAt(flat, new Date(t0))).toBe(timeline[0].speed);
  });
});

describe("slackWindowAround", () => {
  test("extends to the interpolated band crossings either side", () => {
    const w = slackWindowAround(timeline, new Date(t0 + 6 * H), 0.5)!;
    // |3 sin θ| ≤ 0.5 within asin(1/6) of the reversal: about 19 minutes each side.
    const half = (Math.asin(1 / 6) / (2 * Math.PI)) * 12 * H;
    expect((t0 + 6 * H - w.start.getTime()) / M).toBeCloseTo(half / M, 0);
    expect((w.end.getTime() - t0 - 6 * H) / M).toBeCloseTo(half / M, 0);
  });
  test.each([-1, 1])(
    "a signed band crossing across a reversal matches iOS, direction %s",
    (direction) => {
      const tl = series([-1, 0.1, 1].map((v) => v * direction));
      const w = slackWindowAround(tl, new Date(t0 + 545_450), 0.15)!;
      expect((w.start.getTime() - t0) / 1000).toBeCloseTo(463.64, 1);
      expect((w.end.getTime() - t0) / 1000).toBeCloseTo(633.33, 1);
    },
  );
  test("a reversal between two out-of-band samples still has a window where the segment crosses the band", () => {
    const w = slackWindowAround(series([2, 1, -1, -2]), new Date(t0 + 15 * M), 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 12.5 * M);
    expect(w.end.getTime()).toBe(t0 + 17.5 * M);
  });
  test("the reversal can land on the later bracketing sample's side", () => {
    const w = slackWindowAround(series([2, 1, 0.25, -1, -2]), new Date(t0 + 22 * M), 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 10 * M + (10 * M * 0.5) / 0.75);
    expect(w.end.getTime()).toBe(t0 + 26 * M);
  });
  test("a window widens to hold its slack", () => {
    const w = slackWindowAround(series([2, 1, -3, -4]), new Date(t0 + 19 * M), 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 11.25 * M);
    expect(w.end.getTime()).toBe(t0 + 19 * M);
    // One in-band sample, with the slack beyond its crossing toward the fast side.
    const g = slackWindowAround(series([0.3, -3]), new Date(t0 + 6 * M), 0.5)!;
    expect(g.end.getTime()).toBe(t0 + 6 * M);
  });
  test("clamps to the series", () => {
    const w = slackWindowAround(series([0.2, -0.3]), new Date(t0 + 4 * M), 0.5)!;
    expect(w).toEqual({ start: new Date(t0), end: new Date(t0 + 10 * M) });
  });
  test("none outside the series or without a band or a reversal", () => {
    expect(slackWindowAround(series([2, 1]), new Date(t0 - 1), 0.5)).toBeUndefined();
    expect(slackWindowAround([], new Date(t0), 0.5)).toBeUndefined();
    expect(slackWindowAround(series([2, 1, 2]), new Date(t0 + 5 * M), 0.5)).toBeUndefined();
    expect(slackWindowAround(series([2, 1]), new Date(t0 + 10 * M), 0.5)).toBeUndefined();
  });
  test("a threshold at or below zero has no window and zero-width runs", () => {
    expect(slackWindowAround(timeline, events[1].time, 0)).toBeUndefined();
    expect(slackWindowAround(timeline, events[1].time, -1)).toBeUndefined();
    expect(slackRuns(timeline, events, 0)).toEqual([
      { start: events[1].time, end: events[1].time },
    ]);
  });
});

describe("slackRuns", () => {
  test("keeps a window shared by several slacks once", () => {
    const tl = series([1, 0.2, -0.2, 0.2, -0.2, -1]);
    const runs = slackRuns(
      tl,
      [slackAt(t0 + 15 * M), slackAt(t0 + 25 * M), slackAt(t0 + 35 * M)],
      0.5,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].start.getTime()).toBeLessThan(t0 + 10 * M);
    expect(runs[0].end.getTime()).toBeGreaterThan(t0 + 40 * M);
  });
  test("overlapping windows keep their full combined tail", () => {
    const runs = slackRuns(
      series([2, 1, -3, -4]),
      [slackAt(t0 + 12 * M), slackAt(t0 + 19 * M)],
      0.5,
    );
    expect(runs).toEqual([{ start: new Date(t0 + 11.25 * M), end: new Date(t0 + 19 * M) }]);
  });
  test("keeps separate windows apart and skips slacks outside the series", () => {
    const runs = slackRuns(timeline, [...events, slackAt(t0 + 12 * H), slackAt(t0 - H)], 0.5);
    expect(runs).toHaveLength(2);
  });
  test("a slack with no window is a zero-width window", () => {
    const slack = slackAt(t0 + 5 * M);
    expect(slackRuns(series([2, 1, 2]), [slack], 0.5)).toEqual([
      { start: slack.time, end: slack.time },
    ]);
  });
});

describe("readCurrent", () => {
  const dirs = { flood: 45, ebb: 225 };

  test("slack inside a window", () => {
    expect(readCurrent(new Date(t0 + 6 * H), timeline, events, dirs)).toMatchObject({
      state: "Slack",
    });
  });
  test("a weak maximum inside a comfort window still reads Max flood", () => {
    const max: CurrentEvent = { time: new Date(t0 + 10 * M), speed: 0.2, kind: "maxFlood" };
    expect(readCurrent(new Date(t0 + 10 * M), series([0.1, 0.2, 0.1]), [max], dirs)).toMatchObject({
      state: "Max flood",
      direction: 45,
    });
  });
  test("slack is tied to a predicted zero", () => {
    expect(readCurrent(new Date(t0 + 6 * H), timeline, events, dirs)?.state).toBe("Slack");
  });
  test("the phase and set stay readable on either side of zero", () => {
    expect(readCurrent(new Date(t0 + 6 * H - 5 * M), timeline, events, dirs)).toMatchObject({
      state: "Flooding",
      direction: 45,
    });
    expect(readCurrent(new Date(t0 + 6 * H + 5 * M), timeline, events, dirs)).toMatchObject({
      state: "Ebbing",
      direction: 225,
    });
  });
  test("max within a second of a max event", () => {
    expect(readCurrent(new Date(t0 + 3 * H), timeline, events, dirs)).toMatchObject({
      state: "Max flood",
      direction: 45,
    });
    expect(readCurrent(new Date(t0 + 9 * H), timeline, events, dirs)?.state).toBe("Max ebb");
  });
  test("flooding or ebbing, with the phase's set", () => {
    expect(readCurrent(new Date(t0 + 2 * H), timeline, events, dirs)).toMatchObject({
      state: "Flooding",
      direction: 45,
    });
    expect(readCurrent(new Date(t0 + 8 * H), timeline, events, dirs)).toMatchObject({
      state: "Ebbing",
      direction: 225,
    });
  });
  test("no direction when the station has none", () => {
    expect(readCurrent(new Date(t0 + 2 * H), timeline, events, {})).not.toHaveProperty("direction");
  });
  test("undefined outside the series", () => {
    expect(readCurrent(new Date(t0 - H), timeline, events, dirs)).toBeUndefined();
  });
  test("reads at the first and last sample instants", () => {
    expect(readCurrent(timeline[0].time, timeline, events, {})).toBeDefined();
    expect(readCurrent(timeline.at(-1)!.time, timeline, events, {})).toBeDefined();
    expect(
      readCurrent(new Date(timeline.at(-1)!.time.getTime() + 1), timeline, events, {}),
    ).toBeUndefined();
  });
});

describe("maxSpeeds", () => {
  const maxima: CurrentEvent[] = [
    { time: new Date(t0), speed: 4.2, kind: "maxFlood" },
    { time: new Date(t0 + 3 * H), speed: 0, kind: "slack" },
    { time: new Date(t0 + 6 * H), speed: -6.4, kind: "maxEbb" },
  ];
  test("is one direction's unsigned speeds", () => {
    expect(maxSpeeds(maxima, "maxEbb")).toEqual([6.4]);
    expect(maxSpeeds(maxima, "maxFlood")).toEqual([4.2]);
  });
});
