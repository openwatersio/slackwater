import { describe, expect, test } from "vitest";
import {
  eased,
  fastTideInk,
  fastTideText,
  fitScale,
  flowPeaks,
  formatHeight,
  governScale,
  heightUnit,
  lerpScale,
  levelRange,
  rateAt,
  rateColor,
  readTide,
  spokenTide,
  tideRates,
  tideStops,
} from "../src/utils/tide.js";
import type { Extreme } from "../src/types.js";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 10);
const series = (levels: number[], stepMinutes = 60) =>
  levels.map((level, i) => ({ time: new Date(t0 + i * stepMinutes * 60_000), level }));
const extreme = (hours: number, level: number, high: boolean): Extreme => ({
  time: new Date(t0 + hours * H),
  level,
  high,
  low: !high,
  label: high ? "High" : "Low",
});

describe("tideRates", () => {
  test("central differences in metres per hour, one-sided at the ends", () => {
    const rates = tideRates(series([0, 1, 3, 3.5]), "meters");
    expect(rates.map((r) => r.rate)).toEqual([1, 1.5, 1.25, 0.5]);
    expect(rates[1].time).toEqual(new Date(t0 + H));
  });

  test("converts feet to metres first", () => {
    const rates = tideRates(series([0, 3.2808399]), "feet");
    expect(rates[0].rate).toBeCloseTo(1);
  });

  test("a single sample, or a repeated instant, has no rate", () => {
    expect(tideRates(series([2]), "meters")[0].rate).toBe(0);
  });

  test("rateAt interpolates between samples", () => {
    const rates = tideRates(series([0, 1, 3]), "meters");
    expect(rateAt(rates, t0 + 0.5 * H)).toBeCloseTo(1.25);
    expect(rateAt(rates, t0 - 1)).toBeUndefined();
  });
});

describe("flowPeaks", () => {
  const at = (rate: number, i: number) => ({ time: new Date(t0 + i * H), rate });

  test("one peak per rising or falling run, only when it reaches 0.6 m/hr", () => {
    const rates = [0.2, 0.7, 0.9, 0.4, -0.3, -0.5, -0.1, 0.65, 0.6].map(at);
    expect(flowPeaks(rates)).toEqual([at(0.9, 2), at(0.65, 7)]);
  });

  test("a still sample ends a run", () => {
    const rates = [0.8, 0, 1.2].map(at);
    expect(flowPeaks(rates)).toEqual([at(0.8, 0), at(1.2, 2)]);
  });

  test("a falling run's peak is its most negative rate", () => {
    expect(flowPeaks([-0.7, -1.1, -0.9].map(at))).toEqual([at(-1.1, 1)]);
  });
});

test("tideStops names each turn", () => {
  expect(tideStops([extreme(1, 2, true), extreme(7, 0.1, false)])).toEqual([
    { time: t0 + H, label: "High" },
    { time: t0 + 7 * H, label: "Low" },
  ]);
});

describe("vertical scale", () => {
  test("fits around the midpoint with 6% padding and a floor", () => {
    expect(fitScale(-1, 3)).toEqual({ mid: 1, span: 2 * 1.06 });
    expect(fitScale(2, 2)).toEqual({ mid: 2, span: 0.01 * 1.06 });
  });

  test("levelRange spans only the samples inside the window", () => {
    const tl = series([5, 1, 4, 9]);
    expect(levelRange(tl, t0 + H, t0 + 2 * H)).toEqual({ min: 1, max: 4 });
    expect(levelRange(tl, t0 + 10 * H, t0 + 11 * H)).toBeUndefined();
  });

  test("holds the scale while the curve fits comfortably", () => {
    const held = fitScale(0, 4);
    expect(governScale(held, 0.3, 3.7)).toBe(held);
    expect(governScale(held, 2 - 0.96 * held.span, 3)).toBe(held);
  });

  test("expands once the curve reaches past 97% of the held span", () => {
    const held = fitScale(0, 4);
    expect(governScale(held, -0.5, 4)).toEqual(fitScale(-0.5, 4));
  });

  test("contracts once a fresh fit would be under 65% of it", () => {
    const held = fitScale(0, 4);
    expect(governScale(held, 0.8, 3.5)).toBe(held);
    expect(governScale(held, 1.5, 3)).toEqual(fitScale(1.5, 3));
  });

  test("an adopted fit is a fixed point", () => {
    const adopted = governScale(fitScale(0, 4), 1.5, 3);
    expect(governScale(adopted, 1.5, 3)).toBe(adopted);
  });

  test("glides with smoothstep, landing exactly", () => {
    expect([eased(-1), eased(0), eased(0.25), eased(0.5), eased(1), eased(2)]).toEqual([
      0, 0, 0.15625, 0.5, 1, 1,
    ]);
    const a = { mid: 0, span: 1 };
    const b = { mid: 2, span: 3 };
    expect(lerpScale(a, b, 0.5)).toEqual({ mid: 1, span: 2 });
    expect(lerpScale(a, b, eased(1))).toEqual(b);
  });
});

describe("rate colors", () => {
  test("blue below 0.6 m/hr, then the absolute rate ramp", () => {
    expect(rateColor(0.59)).toBeUndefined();
    expect(rateColor(-0.6)).toBe("#f5c96b");
    expect(rateColor(1.5)).toBe("#e8763c");
    expect(rateColor(-3)).toBe("#c93a32");
  });

  test("the fast-tide ink is the ramp lifted a quarter toward white, legible on the canvas", () => {
    expect(fastTideInk(0.5)).toBeUndefined();
    expect(fastTideInk(-1.8)).toBe("#d76b65");
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const s = parseInt(hex.slice(i, i + 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const rate of [0.6, 1, 1.5, 1.8]) {
      const contrast = (luminance(fastTideInk(rate)!) + 0.05) / (luminance("#05122a") + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("fast-tide commentary reads the rate like a height per hour", () => {
    expect(fastTideText(0.59, "meters")).toBeUndefined();
    expect(fastTideText(0.6, "meters", "en-US")).toBe("Rising 0.60 m/hr");
    expect(fastTideText(-1.585, "feet", "en-US")).toBe("Falling 5.2 ft/hr");
    expect(fastTideText(0.75, "meters", "de-DE")).toBe("Rising 0,75 m/hr");
  });
});

describe("readTide", () => {
  const timeline = series([1, 2, 3, 2, 1, 0, 1]);
  const rates = tideRates(timeline, "meters");
  const extremes = [extreme(2, 3.04, true), extreme(5, -0.02, false)];

  test("High or Low within a second of a turn, at the turn's own height", () => {
    expect(readTide(t0 + 2 * H + 1000, timeline, rates, extremes)).toMatchObject({
      state: "High",
      level: 3.04,
      up: true,
    });
    expect(readTide(t0 + 5 * H - 1000, timeline, rates, extremes)?.state).toBe("Low");
    expect(readTide(t0 + 2 * H + 1001, timeline, rates, extremes)?.state).toBe("Falling");
  });

  test("rising toward a high and falling toward a low, interpolating the height", () => {
    expect(readTide(t0 + 0.5 * H, timeline, rates, extremes)).toEqual({
      state: "Rising",
      level: 1.5,
      up: true,
      rate: 1,
    });
    expect(readTide(t0 + 3.5 * H, timeline, rates, extremes)).toMatchObject({
      state: "Falling",
      up: false,
    });
  });

  test("rising when no later turn is loaded, and nothing outside the timeline", () => {
    expect(readTide(t0 + 5.5 * H, timeline, rates, extremes)?.state).toBe("Rising");
    expect(readTide(t0 - 1, timeline, rates, extremes)).toBeUndefined();
  });

  test("speaks the state, the height and its unit, then the dated clock", () => {
    const reading = readTide(t0 + 0.5 * H, timeline, rates, extremes)!;
    expect(spokenTide(reading, t0 + 0.5 * H, "UTC", "meters", "en-US")).toMatch(
      /^Rising 1\.50 metres, Oct 10, 12:30\sAM UTC$/,
    );
    expect(spokenTide({ ...reading, level: 4 }, t0, "UTC", "feet", "en-US")).toMatch(
      /^Rising 4\.0 feet, /,
    );
  });
});

describe("formatHeight", () => {
  test("feet to one decimal and metres to two", () => {
    expect(formatHeight(6.25, "feet", "en-US")).toBe("6.3");
    expect(formatHeight(1.234, "meters", "en-US")).toBe("1.23");
    expect(formatHeight(1234.5, "meters", "en-US")).toBe("1234.50");
    expect(formatHeight(1.5, "meters", "fr-FR")).toBe("1,50");
  });

  test("drops the minus only when the value rounds to zero", () => {
    expect(formatHeight(-0.004, "meters", "en-US")).toBe("0.00");
    expect(formatHeight(-0.04, "meters", "en-US")).toBe("-0.04");
    expect(formatHeight(-0.04, "feet", "en-US")).toBe("0.0");
    expect(formatHeight(-0.06, "feet", "en-US")).toBe("-0.1");
  });

  test("units print as ft and m", () => {
    expect([heightUnit("feet"), heightUnit("meters")]).toEqual(["ft", "m"]);
  });
});
