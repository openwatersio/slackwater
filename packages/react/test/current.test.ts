import { describe, expect, test } from "vitest";
import {
  commentary,
  compass16,
  currentStops,
  formatCountdown,
  formatSpeed,
  isDotRun,
  readCurrent,
  runCenter,
  scrubberStops,
  slackRuns,
  slackWindowAround,
  snapTargets,
  speedAt,
  speedColor,
  spokenReading,
  threadOpacity,
} from "../src/utils/current.js";
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
  test("a reversal between two out-of-band samples still has a window where the segment crosses the band", () => {
    const w = slackWindowAround(series([2, 1, -1, -2]), t0 + 15 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 12.5 * M);
    expect(w.end.getTime()).toBe(t0 + 17.5 * M);
  });
  test("the reversal can land on the later bracketing sample's side", () => {
    const w = slackWindowAround(series([2, 1, 0.25, -1, -2]), t0 + 15 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 10 * M + (10 * M * 0.5) / 0.75);
    expect(w.end.getTime()).toBe(t0 + 20 * M + (10 * M * 0.25) / 0.75);
  });
  test("a reversal window widens to hold its slack", () => {
    const w = slackWindowAround(series([2, 1, -3, -4]), t0 + 19 * M, 0.5)!;
    expect(w.start.getTime()).toBe(t0 + 11.25 * M);
    expect(w.end.getTime()).toBe(t0 + 19 * M);
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
    expect(snapTargets(stops, [off], runs, t0, t0 + H)).toEqual([t0 + 15 * M]);
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
  test("slack only inside a measured window, however slow outside it", () => {
    expect(readCurrent(t0 + 6 * H, timeline, events, [], dirs)?.state).not.toBe("Slack");
    const w = windows[0];
    expect(readCurrent(w.start.getTime(), timeline, events, windows, dirs)?.state).toBe("Slack");
    expect(readCurrent(w.end.getTime(), timeline, events, windows, dirs)?.state).toBe("Ebbing");
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
  test("run openings and closings, and maxima", () => {
    const slacks = [0, 6, 12, 18, 24].map((h) => slackAt(t0 + h * H));
    const stops = currentStops(timeline, [...events, ...slacks], slackRuns(timeline, slacks, 0.5));
    expect(stops.map((s) => s.label)).toEqual([
      "Flood",
      "Max flood",
      "Slack",
      "Ebb",
      "Max ebb",
      "Slack",
      "Flood",
      "Slack",
      "Ebb",
      "Slack",
    ]);
  });
  test("a run clamped by either end of the series has no stop there", () => {
    // Ends 10 minutes after a reversal, inside its window.
    const tail = timeline.slice(0, 74);
    const stops = currentStops(tail, [], slackRuns(tail, [slackAt(t0 + 12 * H)], 0.5));
    expect(stops.map((s) => s.label)).toEqual(["Slack"]);
    const head = currentStops(timeline, [], slackRuns(timeline, [slackAt(t0)], 0.5));
    expect(head.map((s) => s.label)).toEqual(["Flood"]);
  });
  test("a closing within a second of the series end counts as flood", () => {
    const end = timeline[timeline.length - 1].time.getTime();
    const run = { start: new Date(end - 30 * M), end: new Date(end - 500) };
    expect(currentStops(timeline, [], [run]).at(-1)).toEqual({ time: end - 500, label: "Flood" });
  });
  test("names a closing from the water just after it, counting zero as flood", () => {
    const tl = series([-1, -0.2, 0, 0, 1]);
    const [stop] = currentStops(
      tl,
      [],
      [{ start: new Date(t0 + M), end: new Date(t0 + 20 * M) }],
    ).filter((s) => s.label !== "Slack");
    expect(stop.label).toBe("Flood");
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
      { state: "Flooding", speed: 2.3, direction: 45 },
      t,
      "America/Los_Angeles",
      "en-US",
    ),
  ).toMatch(/^Flooding, 2\.3 knots, setting NE, Oct 14, 4:22\sPM PDT$/);
  expect(
    spokenReading(
      { state: "Slack", speed: -0.1, direction: 225 },
      t,
      "America/Los_Angeles",
      "en-US",
    ),
  ).toMatch(/^Slack, 0\.1 knots, Oct 14/);
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
      spoken: "Maximum flood current in 1 hour, 28 minutes",
    });
  });
  test("speaks whole hours and minutes alone", () => {
    expect(commentary(t0 + 28 * 60_000, stops, "en-US")?.spoken).toBe(
      "Maximum flood current in 1 hour",
    );
    expect(commentary(t0 + H, stops, "en-US")?.spoken).toBe("Maximum flood current in 28 minutes");
  });
  test("one cutoff: the first stop more than a second after the selection", () => {
    expect(commentary(stops[0].time - 1000, stops)).toBeUndefined();
    expect(commentary(stops[0].time - 1001, stops)?.stop).toBe(stops[0]);
  });
});
