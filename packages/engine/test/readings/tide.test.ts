import { describe, expect, test } from "vitest";
import {
  flowPeaks,
  levelRange,
  rateAt,
  readTide,
  swingHeights,
  tideRates,
  type TurnPoint,
} from "../../src/index.js";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 10);
const series = (levels: number[], stepMinutes = 60) =>
  levels.map((level, i) => ({ time: new Date(t0 + i * stepMinutes * 60_000), level }));
const extreme = (hours: number, level: number, high: boolean): TurnPoint => ({
  time: new Date(t0 + hours * H),
  level,
  high,
});

describe("tideRates", () => {
  test("central differences in meters per hour, one-sided at the ends", () => {
    const rates = tideRates(series([0, 1, 3, 3.5]), "meters");
    expect(rates.map((r) => r.rate)).toEqual([1, 1.5, 1.25, 0.5]);
    expect(rates[1].time).toEqual(new Date(t0 + H));
  });

  test("converts feet to meters first", () => {
    const rates = tideRates(series([0, 3.2808399]), "feet");
    expect(rates[0].rate).toBeCloseTo(1);
  });

  test("a single sample, or a repeated instant, has no rate", () => {
    expect(tideRates(series([2]), "meters")[0].rate).toBe(0);
  });

  test("rateAt interpolates between samples", () => {
    const rates = tideRates(series([0, 1, 3]), "meters");
    expect(rateAt(rates, new Date(t0 + 0.5 * H))).toBeCloseTo(1.25);
    expect(rateAt(rates, new Date(t0 - 1))).toBeUndefined();
  });
});

describe("flowPeaks", () => {
  const at = (rate: number, i: number) => ({ time: new Date(t0 + i * H), rate });

  test("one peak per rising or falling run, only when it reaches the floor", () => {
    const rates = [0.2, 0.7, 0.9, 0.4, -0.3, -0.5, -0.1, 0.65, 0.6].map(at);
    expect(flowPeaks(rates, 0.6)).toEqual([at(0.9, 2), at(0.65, 7)]);
  });

  test("a still sample ends a run", () => {
    const rates = [0.8, 0, 1.2].map(at);
    expect(flowPeaks(rates, 0.6)).toEqual([at(0.8, 0), at(1.2, 2)]);
  });

  test("a falling run's peak is its most negative rate", () => {
    expect(flowPeaks([-0.7, -1.1, -0.9].map(at), 0.6)).toEqual([at(-1.1, 1)]);
  });

  test("a floor of zero makes every run's fastest sample a peak", () => {
    const rates = tideRates(series([0, 0.1, 0.3, 0.2, 0]), "meters");
    expect(flowPeaks(rates, 0).map((p) => p.rate > 0)).toEqual([true, false]);
  });
});

test("levelRange spans only the samples inside the window", () => {
  const tl = series([5, 1, 4, 9]);
  expect(levelRange(tl, new Date(t0 + H), new Date(t0 + 2 * H))).toEqual({ min: 1, max: 4 });
  expect(levelRange(tl, new Date(t0 + 10 * H), new Date(t0 + 11 * H))).toBeUndefined();
});

describe("readTide", () => {
  test("flat samples retain the default direction without inventing a high or low", () => {
    const flat = series([1, 1, 1]);
    expect(readTide(new Date(t0 + H), flat, tideRates(flat, "meters"), [])).toMatchObject({
      state: "Rising",
      rate: 0,
    });
  });
  const timeline = series([1, 2, 3, 2, 1, 0, 1]);
  const rates = tideRates(timeline, "meters");
  const extremes = [extreme(2, 3.04, true), extreme(5, -0.02, false)];

  test("High or Low within a second of a turn, at the turn's own height", () => {
    expect(readTide(new Date(t0 + 2 * H + 1000), timeline, rates, extremes)).toMatchObject({
      state: "High",
      level: 3.04,
      up: true,
    });
    expect(readTide(new Date(t0 + 5 * H - 1000), timeline, rates, extremes)?.state).toBe("Low");
    expect(readTide(new Date(t0 + 2 * H + 1001), timeline, rates, extremes)?.state).toBe("Falling");
  });

  test("rising toward a high and falling toward a low, interpolating the height", () => {
    expect(readTide(new Date(t0 + 0.5 * H), timeline, rates, extremes)).toEqual({
      state: "Rising",
      level: 1.5,
      up: true,
      rate: 1,
    });
    expect(readTide(new Date(t0 + 3.5 * H), timeline, rates, extremes)).toMatchObject({
      state: "Falling",
      up: false,
    });
  });

  test.each([{ turns: [] }, { turns: [extreme(0, 1, true)] }])(
    "uses the sampled fall when the following turn is absent: $turns",
    ({ turns }) => {
      const falling = series([1, 0.8, 0.6]);
      const reading = readTide(new Date(t0 + H), falling, tideRates(falling, "meters"), turns)!;
      expect(reading.state).toBe("Falling");
      expect(reading.up).toBe(false);
      expect(reading.level).toBe(0.8);
      expect(reading.rate).toBeCloseTo(-0.2);
    },
  );

  test("follows the sampled rise without a later turn and reads nothing outside the timeline", () => {
    expect(readTide(new Date(t0 + 5.5 * H), timeline, rates, extremes)?.state).toBe("Rising");
    expect(readTide(new Date(t0 - 1), timeline, rates, extremes)).toBeUndefined();
  });

  test("reads at the first and last sample instants", () => {
    expect(readTide(timeline[0].time, timeline, rates, extremes)).toBeDefined();
    expect(readTide(timeline.at(-1)!.time, timeline, rates, extremes)).toBeDefined();
    expect(
      readTide(new Date(timeline.at(-1)!.time.getTime() + 1), timeline, rates, extremes),
    ).toBeUndefined();
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
