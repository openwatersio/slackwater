import { describe, expect, test } from "vitest";
import {
  CONTEXT_MIN,
  OFFSET_DAYS,
  fitEndDate,
  gridIndexOf,
  gridIndexOnOrBefore,
  requestSpans,
  selectGrid,
  stagger,
  withinHorizon,
} from "./chs-current-grid.ts";

const DAY = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe("the CHS current fit-end grid", () => {
  test("ends grid point i's fit 28i days after the anchor plus a whole-week stagger", () => {
    expect(fitEndDate(0)).toBe("2026-10-29");
    expect(fitEndDate(1)).toBe("2026-12-03");
    expect(fitEndDate(4)).toBe("2027-02-18");
    expect(fitEndDate(-1)).toBe("2026-10-22");
    expect(fitEndDate(-4)).toBe("2026-07-09");
    expect(fitEndDate(-13)).toBe("2025-11-20");
  });

  test("staggers negative grid points forward", () => {
    expect(stagger(-1)).toBe(21);
    expect(stagger(-4)).toBe(0);
    expect(stagger(5)).toBe(7);
  });

  test("puts every fit end on the epoch-week grid, in order", () => {
    let previous = -Infinity;
    for (let i = -40; i <= 40; i++) {
      const t = utc(fitEndDate(i));
      // The epoch began on a Thursday, as every IWLS chunk week does.
      expect((t / DAY) % 7).toBe(0);
      expect(t).toBeGreaterThan(previous);
      previous = t;
    }
  });

  test("rejects a fractional grid index", () => {
    expect(() => fitEndDate(0.5)).toThrow(RangeError);
  });

  test("finds the newest grid point on or before a date", () => {
    expect(gridIndexOnOrBefore("2026-10-22")).toBe(-1);
    expect(gridIndexOnOrBefore("2026-10-28")).toBe(-1);
    expect(gridIndexOnOrBefore("2026-10-29")).toBe(0);
    expect(gridIndexOnOrBefore("2026-12-02")).toBe(0);
    expect(() => gridIndexOnOrBefore("not a date")).toThrow(RangeError);
  });

  test("finds a grid point only by its own fit-end date", () => {
    expect(gridIndexOf("2026-09-17")).toBe(-2);
    expect(() => gridIndexOf("2026-10-30")).toThrow(/2026-10-29/);
  });

  test("keeps every held-out week and its pairing context inside the event horizon", () => {
    const horizon = utc("2028-01-01");
    expect(withinHorizon(utc(fitEndDate(5)), horizon)).toBe(true);
    expect(withinHorizon(utc(fitEndDate(6)), horizon)).toBe(false);
    expect(withinHorizon(utc(fitEndDate(6)), horizon, [28])).toBe(true);
  });

  test("lets the last week's pairing context reach the horizon but not pass it", () => {
    const fitEnd = utc(fitEndDate(0));
    const last = fitEnd + (270 + 7) * DAY + CONTEXT_MIN * 60_000;
    expect(withinHorizon(fitEnd, last)).toBe(true);
    // The same span one millisecond longer.
    expect(withinHorizon(fitEnd + 1, last)).toBe(false);
  });

  test("splits a held-out week and its pairing context into requests of at most seven days", () => {
    const from = utc(fitEndDate(0)) - CONTEXT_MIN * 60_000;
    const to = utc(fitEndDate(0)) + 7 * DAY + CONTEXT_MIN * 60_000;
    expect(requestSpans(from, to)).toEqual([
      [from, from + 7 * DAY],
      [from + 7 * DAY, to],
    ]);
    expect(requestSpans(from, from + 7 * DAY)).toEqual([[from, from + 7 * DAY]]);
    expect(requestSpans(from, from)).toEqual([]);
  });

  test("spreads every held-out age across the perigee cycle", () => {
    const anomalistic = 27.55455;
    const largestGap = (fitEnd: (i: number) => number, offset: number) => {
      const phases = Array.from({ length: 13 }, (_, k) => {
        const days = fitEnd(k - 12) / DAY + offset;
        return ((days % anomalistic) + anomalistic) % anomalistic;
      }).sort((a, b) => a - b);
      let gap = anomalistic - phases[12] + phases[0];
      for (let k = 1; k < 13; k++) gap = Math.max(gap, phases[k] - phases[k - 1]);
      return gap;
    };
    for (const offset of OFFSET_DAYS) {
      // Shorter than a held-out week, so the weeks cover every phase.
      expect(largestGap((i) => utc(fitEndDate(i)), offset)).toBeLessThan(7);
      // A plain 28-day grid would leave most of the cycle unscored.
      expect(largestGap((i) => utc("2026-10-29") + 28 * i * DAY, offset)).toBeGreaterThan(20);
    }
  });
});

describe("selectGrid", () => {
  test("defaults to the newest grid point on or before today", () => {
    expect(selectGrid({}, "2026-10-22")).toEqual([-1]);
  });

  test("reads a range or a list", () => {
    expect(selectGrid({ GRID: "-2..0" }, "2026-10-29")).toEqual([-2, -1, 0]);
    expect(selectGrid({ GRID: "-1,0" }, "2026-10-29")).toEqual([-1, 0]);
  });

  test("reads a fit-end date", () => {
    expect(selectGrid({ FIT_END: "2026-09-17" }, "2026-10-29")).toEqual([-2]);
  });

  test("refuses grid points after today, malformed input, and both inputs at once", () => {
    expect(() => selectGrid({ GRID: "1" }, "2026-10-29")).toThrow(/after/);
    expect(() => selectGrid({ GRID: "0..-1" }, "2026-10-29")).toThrow(RangeError);
    expect(() => selectGrid({ GRID: "x" }, "2026-10-29")).toThrow(RangeError);
    expect(() => selectGrid({ GRID: "0", FIT_END: "2026-10-29" }, "2026-10-29")).toThrow(
      RangeError,
    );
  });

  test("refuses an empty GRID or FIT_END rather than falling back to the default", () => {
    expect(() => selectGrid({ GRID: "" }, "2026-10-29")).toThrow(RangeError);
    expect(() => selectGrid({ FIT_END: "" }, "2026-10-29")).toThrow(RangeError);
  });
});
