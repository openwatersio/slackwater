import { describe, expect, test } from "vitest";
import { readCurrent, slackRuns } from "@slackwater/engine";
import {
  formatSet,
  spokenSet,
  currentStops,
  formatSpeed,
  isDotRun,
  runCenter,
  slackAxisTimes,
  snapTargets,
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

test("Set defaults to compass and degree readings wrap and pad without a true suffix", () => {
  expect(formatSet(225)).toBe("SW");
  expect(formatSet(5, "degrees")).toBe("005°");
  expect(formatSet(359.8, "degrees")).toBe("000°");
  expect(formatSet(-1, "degrees")).toBe("359°");
  expect(spokenSet(225)).toBe("set southwest");
  expect(spokenSet(5, "degrees")).toBe("set 5 degrees");
});

test.each([
  [0, "north"],
  [22.5, "north-northeast"],
  [45, "northeast"],
  [67.5, "east-northeast"],
  [90, "east"],
  [112.5, "east-southeast"],
  [135, "southeast"],
  [157.5, "south-southeast"],
  [180, "south"],
  [202.5, "south-southwest"],
  [225, "southwest"],
  [247.5, "west-southwest"],
  [270, "west"],
  [292.5, "west-northwest"],
  [315, "northwest"],
  [337.5, "north-northwest"],
])("speaks compass bearing %s as %s", (bearing, name) => {
  expect(spokenSet(Number(bearing))).toBe(`set ${name}`);
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

const M = 60_000;
/** Ten-minute samples from t0 with the given speeds. */
const series = (speeds: number[]) =>
  speeds.map((speed, i) => ({ time: new Date(t0 + i * 10 * M), speed }));
const slackAt = (t: number): CurrentEvent => ({ time: new Date(t), speed: 0, kind: "slack" });

describe("dot runs", () => {
  test("a slack with no window is a zero-width dot run: one Slack stop, and the lead reads Slack on it", () => {
    const tl = series([2, 1, 2]);
    const slack = slackAt(t0 + 5 * M);
    const runs = slackRuns(tl, [slack], 0.5);
    expect(isDotRun(runs[0])).toBe(true);
    expect(currentStops(tl, [slack], runs)).toEqual([{ time: t0 + 5 * M, label: "Slack" }]);
    expect(readCurrent(new Date(t0 + 5 * M), tl, [slack], {})?.state).toBe("Slack");
    expect(readCurrent(new Date(t0 + 5 * M + 2000), tl, [slack], {})?.state).toBe("Flooding");
  });
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
  ).toMatch(/^2\.4 knots, set northeast, Oct 14, 4:22\sPM PDT$/);
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

test("minima remain labeled navigation destinations", () => {
  const minima: CurrentEvent[] = [
    { time: new Date(t0 + H), speed: 0.01, kind: "minFlood" },
    { time: new Date(t0 + 2 * H), speed: -0.01, kind: "minEbb" },
  ];
  const stops = currentStops(timeline, minima, []);
  expect(stops.map((s) => s.label)).toEqual(["Minimum flood", "Minimum ebb"]);
  expect(snapTargets(stops, minima, [], t0, t0 + 3 * H)).toEqual([t0 + H, t0 + 2 * H]);
});
