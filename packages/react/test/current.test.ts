import { describe, expect, test } from "vitest";
import {
  compass16,
  currentStops,
  formatSpeed,
  isDotRun,
  readCurrent,
  runCenter,
  slackRuns,
  slackAxisTimes,
  slackWindowAround,
  snapTargets,
  speedAt,
  speedColor,
  spokenReading,
  threadOpacity,
} from "../src/utils/current.js";
import { commentary, formatCountdown, scrubberStops } from "../src/utils/scrubber.js";
import type { CurrentEvent } from "../src/types.js";

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

test("uses a nonreciprocal published ebb bearing when vector data is unavailable", () => {
  const reading = readCurrent(t0 + 8 * H, timeline, events, [], { flood: 45, ebb: 200 })!;
  expect(reading.direction).toBe(200);
  expect(spokenReading(reading, t0 + 8 * H, "UTC", "en-US")).toContain("set 200 degrees true, SSW");
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
    const reading = readCurrent(t0, tl, [slackAt(t0)], [], { flood: 0, ebb: 180 })!;
    expect(reading).toMatchObject({ speed: 0, magnitude: 2, direction: 90 });
    expect(spokenReading(reading, t0, "UTC", "en-US")).toMatch(
      /^2.0 knots, set 90 degrees true, E,/,
    );
    expect(spokenReading(reading, t0, "UTC", "en-US")).not.toMatch(/slack/i);
  });
  test("interpolates vectors through north rather than turning south", () => {
    const reading = readCurrent(t0 + H / 2, [point(0, 1, 1, 350), point(1, 1, 1, 10)], [], [], {})!;
    expect(reading.magnitude).toBeCloseTo(0.984807753);
    expect(reading.direction).toBeCloseTo(0);
  });
  test("opposite vectors cancel without inventing a set", () => {
    const reading = readCurrent(
      t0 + H / 2,
      [point(0, 1, 1, 90), point(1, -1, 1, 270)],
      [],
      [],
      {},
    )!;
    expect(reading.magnitude).toBeCloseTo(0);
    expect(reading).not.toHaveProperty("direction");
  });
  test("interpolates from a zero vector with no bearing", () => {
    const tl = [point(0, 0, 0), point(1, 1, 1, 90)];
    expect(readCurrent(t0, tl, [], [], {})).toMatchObject({ magnitude: 0 });
    expect(readCurrent(t0, tl, [], [], {})).not.toHaveProperty("direction");
    expect(readCurrent(t0 + H / 2, tl, [], [], {})).toMatchObject({
      magnitude: 0.5,
      direction: 90,
    });
  });
  test("preserves speed without a known set, including a known endpoint beside an unknown one", () => {
    const tl = [point(0, 1, 2, 90), point(1, 1, 3)];
    expect(readCurrent(t0, tl, [], [], {})).toMatchObject({ magnitude: 2, direction: 90 });
    expect(readCurrent(t0 + H / 2, tl, [], [], {})).toMatchObject({ magnitude: 2.5 });
    expect(readCurrent(t0 + H / 2, tl, [], [], {})).not.toHaveProperty("direction");
    expect(readCurrent(t0 + H, tl, [], [], {})).not.toHaveProperty("direction");
  });
  test.each([1, -1])(
    "keeps scalar phase bearings through a nonreciprocal reversal, direction %s",
    (sign) => {
      const tl =
        sign > 0
          ? [point(0, 0.3, 0.3, 45), point(1, -0.3, 0.3, 200)]
          : [point(0, -0.3, 0.3, 200), point(1, 0.3, 0.3, 45)];
      const zero = readCurrent(t0 + H / 2, tl, [], [], { flood: 45, ebb: 200 })!;
      expect(zero.magnitude).toBe(0);
      expect(zero).not.toHaveProperty("direction");
      const before = readCurrent(t0 + H * 0.4, tl, [], [], { flood: 45, ebb: 200 })!;
      expect(before.magnitude).toBeCloseTo(0.06);
      expect(before.direction).toBe(sign > 0 ? 45 : 200);
      const after = readCurrent(t0 + H * 0.6, tl, [], [], { flood: 45, ebb: 200 })!;
      expect(after.magnitude).toBeCloseTo(0.06);
      expect(after.direction).toBe(sign > 0 ? 200 : 45);
    },
  );

  test("falls back to absolute signed speed for older sources", () => {
    expect(readCurrent(t0 + 8 * H, timeline, events, [], { ebb: 200 })?.magnitude).toBeCloseTo(
      2.598076211353316,
    );
    const zero = readCurrent(t0 + 6 * H, timeline, events, [], { flood: 45, ebb: 225 })!;
    expect(zero.magnitude).toBeCloseTo(0);
    expect(zero).not.toHaveProperty("direction");
  });
});

describe("speedColor", () => {
  test("clamps below the first anchor and above the last", () => {
    expect(speedColor(0)).toBe("#f5c96b");
    expect(speedColor(-20)).toBe("#c93a32");
  });
  test("interpolates between anchors", () => {
    expect(speedColor(3)).toBe("#f5c96b");
    expect(speedColor(8)).toBe("#e8763c");
    expect(speedColor(5.5)).toBe("#efa054");
  });
});

test("threadOpacity fades in from 0.5 to 3 kn", () => {
  expect(threadOpacity(0.4)).toBe(0);
  expect(threadOpacity(-1.75)).toBe(0.5);
  expect(threadOpacity(4)).toBe(1);
});

test("compass16", () => {
  expect(compass16(0)).toBe("N");
  expect(compass16(349)).toBe("N");
  expect(compass16(22.5)).toBe("NNE");
  expect(compass16(225)).toBe("SW");
  expect(compass16(-90)).toBe("W");
});

describe("speedAt", () => {
  test("interpolates and is undefined outside the series", () => {
    expect(speedAt(timeline, t0 + 300_000)).toBeCloseTo(
      (timeline[0].speed + timeline[1].speed) / 2,
    );
    expect(speedAt(timeline, t0 - 1)).toBeUndefined();
    expect(speedAt([], t0)).toBeUndefined();
  });
  test("handles duplicate samples", () => {
    const flat = [timeline[0], timeline[0]];
    expect(speedAt(flat, t0)).toBe(timeline[0].speed);
  });
});

const M = 60_000;
/** Ten-minute samples from t0 with the given speeds. */
const series = (speeds: number[]) =>
  speeds.map((speed, i) => ({ time: new Date(t0 + i * 10 * M), speed }));
const slackAt = (t: number): CurrentEvent => ({ time: new Date(t), speed: 0, kind: "slack" });

describe("slackWindowAround", () => {
  test("extends to the interpolated band crossings either side", () => {
    const w = slackWindowAround(timeline, t0 + 6 * H, 0.5)!;
    // |3 sin θ| ≤ 0.5 within asin(1/6) of the reversal: about 19 minutes each side.
    const half = (Math.asin(1 / 6) / (2 * Math.PI)) * 12 * H;
    expect((t0 + 6 * H - w.start.getTime()) / M).toBeCloseTo(half / M, 0);
    expect((w.end.getTime() - t0 - 6 * H) / M).toBeCloseTo(half / M, 0);
  });
  test.each([-1, 1])(
    "a signed band crossing across a reversal matches iOS, direction %s",
    (direction) => {
      const tl = series([-1, 0.1, 1].map((v) => v * direction));
      const w = slackWindowAround(tl, t0 + 545_450, 0.15)!;
      expect((w.start.getTime() - t0) / 1000).toBeCloseTo(463.64, 1);
      expect((w.end.getTime() - t0) / 1000).toBeCloseTo(633.33, 1);
    },
  );
  test("a reversal between two out-of-band samples still has a window where the segment crosses the band", () => {
    const w = slackWindowAround(series([2, 1, -1, -2]), t0 + 15 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 12.5 * M);
    expect(w.end.getTime()).toBe(t0 + 17.5 * M);
  });
  test("the reversal can land on the later bracketing sample's side", () => {
    const w = slackWindowAround(series([2, 1, 0.25, -1, -2]), t0 + 22 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 10 * M + (10 * M * 0.5) / 0.75);
    expect(w.end.getTime()).toBe(t0 + 26 * M);
  });
  test("a window widens to hold its slack", () => {
    const w = slackWindowAround(series([2, 1, -3, -4]), t0 + 19 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 11.25 * M);
    expect(w.end.getTime()).toBe(t0 + 19 * M);
    // One in-band sample, with the slack beyond its crossing toward the fast side.
    const g = slackWindowAround(series([0.3, -3]), t0 + 6 * M, 0.5)!;
    expect(g.end.getTime()).toBe(t0 + 6 * M);
  });
  test("clamps to the series", () => {
    const w = slackWindowAround(series([0.2, -0.3]), t0 + 4 * M, 0.5)!;
    expect(w).toEqual({ start: new Date(t0), end: new Date(t0 + 10 * M) });
  });
  test("none outside the series or without a band or a reversal", () => {
    expect(slackWindowAround(series([2, 1]), t0 - 1, 0.5)).toBeUndefined();
    expect(slackWindowAround([], t0, 0.5)).toBeUndefined();
    expect(slackWindowAround(series([2, 1, 2]), t0 + 5 * M, 0.5)).toBeUndefined();
    expect(slackWindowAround(series([2, 1]), t0 + 10 * M, 0.5)).toBeUndefined();
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
  test("a slack with no window is a zero-width dot run: one Slack stop, and the lead reads Slack on it", () => {
    const tl = series([2, 1, 2]);
    const slack = slackAt(t0 + 5 * M);
    const runs = slackRuns(tl, [slack], 0.5);
    expect(runs).toEqual([{ start: slack.time, end: slack.time }]);
    expect(isDotRun(runs[0])).toBe(true);
    expect(currentStops(tl, [slack], runs)).toEqual([{ time: t0 + 5 * M, label: "Slack" }]);
    expect(readCurrent(t0 + 5 * M, tl, [slack], runs, {})?.state).toBe("Slack");
    expect(readCurrent(t0 + 5 * M + 2000, tl, [slack], runs, {})?.state).toBe("Flooding");
  });
});

describe("dot runs", () => {
  test("a run under the five-unit dot (1000 s) is a dot; one at it is a stroke", () => {
    expect(isDotRun({ start: new Date(t0), end: new Date(t0 + 999_999) })).toBe(true);
    expect(isDotRun({ start: new Date(t0), end: new Date(t0 + 1_000_000) })).toBe(false);
    expect(runCenter({ start: new Date(t0), end: new Date(t0 + 10 * M) })).toBe(t0 + 5 * M);
  });
  test("a dot run is one Slack stop at its center, and its slack snaps to that stop alone", () => {
    const tl = series([2, 1, -1, -2, -3]);
    const slack = slackAt(t0 + 15 * M);
    const runs = slackRuns(tl, [slack], 0.5);
    expect(isDotRun(runs[0])).toBe(true);
    const stops = currentStops(tl, [slack], runs);
    expect(stops).toEqual([{ time: t0 + 15 * M, label: "Slack" }]);
    const off: CurrentEvent = { ...slack, time: new Date(t0 + 14 * M) };
    expect(snapTargets(currentStops(tl, [off], runs), [off], runs, t0, t0 + H)).toEqual([
      t0 + 14 * M,
    ]);
  });
});

describe("readCurrent", () => {
  const windows = slackRuns(timeline, events, 0.5);
  const dirs = { flood: 45, ebb: 225 };

  test("slack inside a window", () => {
    expect(readCurrent(t0 + 6 * H, timeline, events, windows, dirs)).toMatchObject({
      state: "Slack",
    });
  });
  test("slack is tied to a predicted zero, independently of the comfort window", () => {
    expect(readCurrent(t0 + 6 * H, timeline, events, [], dirs)?.state).toBe("Slack");
    const w = windows[0];
    expect(readCurrent(w.start.getTime(), timeline, events, windows, dirs)?.state).toBe("Flooding");
    expect(readCurrent(w.end.getTime(), timeline, events, windows, dirs)?.state).toBe("Ebbing");
  });
  test("comfort windows do not hide the phase or set on either side of zero", () => {
    expect(readCurrent(t0 + 6 * H - 5 * M, timeline, events, windows, dirs)).toMatchObject({
      state: "Flooding",
      direction: 45,
    });
    expect(readCurrent(t0 + 6 * H + 5 * M, timeline, events, windows, dirs)).toMatchObject({
      state: "Ebbing",
      direction: 225,
    });
    expect(readCurrent(t0 + 6 * H, timeline, events, [], dirs)?.state).toBe("Slack");
  });
  test("a weak maximum inside a comfort window still reads Max flood", () => {
    const tl = series([0.1, 0.2, 0.1]);
    const max: CurrentEvent = { time: new Date(t0 + 10 * M), speed: 0.2, kind: "maxFlood" };
    expect(
      readCurrent(
        t0 + 10 * M,
        tl,
        [max],
        [{ start: new Date(t0), end: new Date(t0 + 20 * M) }],
        dirs,
      ),
    ).toMatchObject({ state: "Max flood", direction: 45 });
  });
  test("max within a second of a max event", () => {
    expect(readCurrent(t0 + 3 * H, timeline, events, windows, dirs)).toMatchObject({
      state: "Max flood",
      direction: 45,
    });
    expect(readCurrent(t0 + 9 * H, timeline, events, windows, dirs)?.state).toBe("Max ebb");
  });
  test("flooding or ebbing, with the phase's set", () => {
    expect(readCurrent(t0 + 2 * H, timeline, events, windows, dirs)).toMatchObject({
      state: "Flooding",
      direction: 45,
    });
    expect(readCurrent(t0 + 8 * H, timeline, events, windows, dirs)).toMatchObject({
      state: "Ebbing",
      direction: 225,
    });
  });
  test("no direction when the station has none", () => {
    expect(readCurrent(t0 + 2 * H, timeline, events, windows, {})).not.toHaveProperty("direction");
  });
  test("undefined outside the series", () => {
    expect(readCurrent(t0 - H, timeline, events, windows, dirs)).toBeUndefined();
  });
});

describe("currentStops", () => {
  test("walks the window opening, exact zero, closing and maximum in order", () => {
    const stops = currentStops(timeline, events, slackRuns(timeline, events, 0.5));
    expect(stops.map((s) => s.label)).toEqual([
      "Max flood",
      "Slack window",
      "Slack",
      "Slack window closes",
      "Max ebb",
    ]);
    expect(stops[2].time).toBe(t0 + 6 * H);
    expect(stops[1].time).toBeLessThan(stops[2].time);
    expect(stops[3].time).toBeGreaterThan(stops[2].time);
  });
  test("a window clamped to the sampled boundary invents no edge stop", () => {
    const tail = timeline.slice(0, 74);
    expect(
      currentStops(tail, [], slackRuns(tail, [slackAt(t0 + 12 * H)], 0.5)).map((s) => s.label),
    ).toEqual(["Slack window"]);
    expect(
      currentStops(timeline, [], slackRuns(timeline, [slackAt(t0)], 0.5)).map((s) => s.label),
    ).toEqual(["Slack window closes"]);
  });
  test("a zero at a window opening is named Slack", () => {
    const zero = slackAt(t0 + 20 * M);
    expect(
      currentStops(timeline, [zero], [{ start: zero.time, end: new Date(t0 + 40 * M) }]),
    ).toEqual([
      { time: t0 + 20 * M, label: "Slack" },
      { time: t0 + 40 * M, label: "Slack window closes" },
    ]);
  });
  test("a zero at a window closing is named Slack", () => {
    const zero = slackAt(t0 + 20 * M);
    const stops = currentStops(timeline, [zero], [{ start: new Date(t0 + M), end: zero.time }]);
    expect(stops).toEqual([
      { time: t0 + M, label: "Slack window" },
      { time: t0 + 20 * M, label: "Slack" },
    ]);
  });
  test("short and disabled windows retain the exact zero and no window stops", () => {
    const tl = series([2, 1, -1, -2]);
    const zero = slackAt(t0 + 14 * M);
    for (const threshold of [0, 0.5]) {
      expect(currentStops(tl, [zero], slackRuns(tl, [zero], threshold))).toEqual([
        { time: t0 + 14 * M, label: "Slack" },
      ]);
    }
  });
});

describe("scrubberStops", () => {
  const day = { start: t0, end: t0 + 24 * H, sunrise: t0 + 3 * H, sunset: t0 + 30 * H };
  test("keeps only stops inside the drawn data, sun first on a shared instant", () => {
    const water = [
      { time: t0 + 3 * H, label: "Max flood" as const },
      { time: t0 + 40 * H, label: "Slack" as const },
    ];
    expect(scrubberStops(water, [day, { start: 0, end: 0 }], t0, t0 + 24 * H)).toEqual([
      { time: t0 + 3 * H, label: "Sunrise" },
      { time: t0 + 3 * H, label: "Max flood" },
    ]);
  });
});

test("snapTargets: stops and slack instants inside the window, sorted and unique", () => {
  const stops = [
    { time: t0 + 2 * H, label: "Slack" as const },
    { time: t0 + 9 * H, label: "Max ebb" as const },
  ];
  expect(
    snapTargets(stops, [...events, slackAt(t0 + 2 * H), slackAt(t0 + 30 * H)], [], t0, t0 + 24 * H),
  ).toEqual([t0 + 2 * H, t0 + 6 * H, t0 + 9 * H]);
});

test("formatSpeed: one decimal in the locale, no negative zero", () => {
  expect(formatSpeed(-0.04, "en-US")).toBe("0.0");
  expect(formatSpeed(-2.345, "en-US")).toBe("2.3");
  expect(formatSpeed(2.25, "de-DE")).toBe("2,3");
});

test("spokenReading: state, speed, set when known, then dated clock and zone", () => {
  const t = Date.parse("2026-10-14T23:22:00Z");
  expect(
    spokenReading(
      { state: "Flooding", speed: 2.3, magnitude: 2.4, direction: 45 },
      t,
      "America/Los_Angeles",
      "en-US",
    ),
  ).toMatch(/^2\.4 knots, set 45 degrees true, NE, Oct 14, 4:22\sPM PDT$/);
  expect(
    spokenReading({ state: "Slack", speed: 0, magnitude: 0 }, t, "America/Los_Angeles", "en-US"),
  ).toMatch(/^0\.0 knots, Oct 14/);
});

test("formatCountdown floors to minutes", () => {
  expect(formatCountdown(28.9 * 60_000)).toBe("28m");
  expect(formatCountdown((3 * 60 + 28) * 60_000 + 59_000)).toBe("3h 28m");
});

describe("commentary", () => {
  const stops = [{ time: t0 + H + 28 * 60_000, label: "Max flood" as const }];
  test("names the next stop with a compact countdown and a spoken label", () => {
    expect(commentary(t0, stops, "en-US")).toEqual({
      stop: stops[0],
      duration: "1h 28m",
      spoken: "Maximum flood along the major axis in 1 hour, 28 minutes",
    });
  });
  test("speaks whole hours and minutes alone", () => {
    expect(commentary(t0 + 28 * 60_000, stops, "en-US")?.spoken).toBe(
      "Maximum flood along the major axis in 1 hour",
    );
    expect(commentary(t0 + H, stops, "en-US")?.spoken).toBe(
      "Maximum flood along the major axis in 28 minutes",
    );
  });
  test("one cutoff: the first stop more than a second after the selection", () => {
    expect(commentary(stops[0].time - 1000, stops)).toBeUndefined();
    expect(commentary(stops[0].time - 1001, stops)?.stop).toBe(stops[0]);
  });
});

test("Slack axis names ordinary openings, each zero in continuous windows, and bare slacks", () => {
  const windows = [
    { start: new Date(t0), end: new Date(t0 + 15 * H) },
    { start: new Date(t0 + 20 * H), end: new Date(t0 + 22 * H) },
  ];
  expect(slackAxisTimes(windows, [t0 + 6 * H, t0 + 12 * H, t0 + 18 * H, t0 + 21 * H])).toEqual([
    t0 + 6 * H,
    t0 + 12 * H,
    t0 + 18 * H,
    t0 + 20 * H,
  ]);
});
