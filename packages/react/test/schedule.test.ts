import { describe, expect, test } from "vitest";
import {
  AHEAD_MS,
  BACK_MS,
  nearestEntry,
  scheduleDays,
  stationWindow,
  type ScheduleEntry,
} from "../src/utils/schedule.js";
import { startOfDay } from "../src/utils/time.js";

const H = 3_600_000;
const TZ = "America/Los_Angeles";
// Station-local midnight, Thursday Oct 15 2026 (PDT).
const anchor = Date.parse("2026-10-15T07:00:00Z");
const at = (hours: number, pill: ScheduleEntry["pill"] = "high"): ScheduleEntry => ({
  time: anchor + hours * H,
  pill,
});

describe("scheduleDays", () => {
  test("groups the week's entries by station-local day, in time order", () => {
    const entries = [at(30, "low"), at(2), at(23.5, "low"), at(25)];
    expect(scheduleDays(entries, anchor, TZ)).toEqual([
      { start: anchor, entries: [at(2), at(23.5, "low")] },
      { start: anchor + 24 * H, entries: [at(25), at(30, "low")] },
    ]);
  });

  test("keeps only the seven days from the anchor and leaves out empty days", () => {
    const days = scheduleDays([at(-1), at(0), at(100), at(7 * 24 - 0.01), at(7 * 24)], anchor, TZ);
    expect(days.map((d) => d.start)).toEqual([
      anchor,
      startOfDay(anchor + 100 * H, TZ),
      anchor + 6 * 24 * H,
    ]);
  });

  test("a week across the fall-back change still ends at the seventh local midnight", () => {
    const fall = Date.parse("2026-10-29T07:00:00Z");
    const end = Date.parse("2026-11-05T08:00:00Z");
    const days = scheduleDays(
      [
        { time: end - 1, pill: "low" },
        { time: end, pill: "high" },
      ],
      fall,
      TZ,
    );
    expect(days).toEqual([{ start: end - 24 * H, entries: [{ time: end - 1, pill: "low" }] }]);
  });
});

test("nearestEntry picks the closest time, the earlier on a tie", () => {
  const entries = [at(2), at(8), at(14)];
  expect(nearestEntry(entries, anchor + 4 * H)).toBe(anchor + 2 * H);
  expect(nearestEntry(entries, anchor + 5 * H)).toBe(anchor + 2 * H);
  expect(nearestEntry(entries, anchor + 5.1 * H)).toBe(anchor + 8 * H);
  expect(nearestEntry([], anchor)).toBeUndefined();
});

test("stationWindow reaches 96 hours back and 180 ahead", () => {
  expect([BACK_MS, AHEAD_MS]).toEqual([96 * H, 180 * H]);
  expect(stationWindow(anchor)).toEqual({
    start: "2026-10-11T07:00:00.000Z",
    end: "2026-10-22T19:00:00.000Z",
  });
});
