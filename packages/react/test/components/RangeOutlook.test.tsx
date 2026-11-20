import { expect, test } from "vitest";
import { render, renderHook, waitFor, screen } from "@testing-library/react";
import {
  RangeOutlook,
  StationRangeOutlook,
  useOutlookWeek,
} from "../../src/components/RangeOutlook.js";
import type { Extreme } from "../../src/types.js";
import { createTestWrapper } from "../helpers.js";
import { addDays, startOfDay } from "../../src/utils/time.js";

const H = 3_600_000;

test("the shifted outlook loads seven complete days beyond the scrubber window", async () => {
  const timezone = "America/Los_Angeles";
  const anchor = startOfDay(Date.now(), timezone);
  const { container, rerender } = render(
    <StationRangeOutlook
      id="noaa/9447130"
      anchor={anchor}
      time={addDays(anchor, 5, timezone)}
      timezone={timezone}
    />,
    { wrapper: createTestWrapper() },
  );
  expect(screen.getByRole("img", { name: /^Daily tide ranges:/ })).toBeDefined();
  const bars = () => [...container.querySelectorAll("span")];
  await waitFor(() => expect(bars()).toHaveLength(7), { timeout: 10000 });
  rerender(
    <StationRangeOutlook
      id="noaa/9447130"
      anchor={anchor}
      time={addDays(anchor, -1, timezone)}
      timezone={timezone}
    />,
  );
  await waitFor(() => expect(bars()).toHaveLength(7), { timeout: 10000 });
});

/** Two highs and two lows a day, the day's bigger swing growing a foot each day. */
function week(start: number): Extreme[] {
  const turns: Extreme[] = [];
  for (let day = -1; day < 9; day++) {
    for (const [hour, level, high] of [
      [3, 0, false],
      [9, 4 + day, true],
      [15, 1, false],
      [21, 3, true],
    ] as const) {
      turns.push({
        time: new Date(start + (day * 24 + hour) * H),
        level,
        high,
        low: !high,
        label: high ? "High" : "Low",
      });
    }
  }
  return turns;
}

test("draws the highs and lows it is given, with no provider", () => {
  const start = Date.UTC(2026, 10, 20);
  const { container } = render(
    <RangeOutlook
      week={start}
      extremes={week(start)}
      units="feet"
      time={start + 2 * 24 * H + 12 * H}
      timezone="UTC"
      locale="en-US"
    />,
  );
  const label = screen.getByRole("img").getAttribute("aria-label")!;
  expect(label).toMatch(/^Daily tide ranges: Friday, Nov 20: 4\.0 ft; Saturday, Nov 21: 5\.0 ft;/);
  const bars = [...container.querySelectorAll<HTMLElement>("[style]")];
  expect(bars.map((b) => b.style.opacity)).toEqual(["0.4", "0.4", "1", "0.4", "0.4", "0.4", "0.4"]);
  expect(bars[6].style.height).toBe("62px"); // the week's biggest swing fills the tile
});

test("with no moment, every day is drawn alike", () => {
  const start = Date.UTC(2026, 10, 20);
  const { container } = render(
    <RangeOutlook week={start} extremes={week(start)} units="feet" timezone="UTC" />,
  );
  const bars = [...container.querySelectorAll<HTMLElement>("[style]")];
  expect(new Set(bars.map((b) => b.style.opacity))).toEqual(new Set(["1"]));
});

test("the week holds while the moment is inside it, moves once it leaves, and is the anchor with no moment", () => {
  const tz = "UTC";
  const anchor = Date.UTC(2026, 10, 20);
  const { result, rerender } = renderHook(
    ({ time }: { time?: number }) => useOutlookWeek(anchor, time, tz),
    { initialProps: { time: undefined as number | undefined } },
  );
  expect(result.current).toBe(anchor);
  rerender({ time: anchor + 4 * 24 * H });
  expect(result.current).toBe(anchor);
  rerender({ time: anchor + 5 * 24 * H + H });
  expect(result.current).toBe(anchor + 5 * 24 * H);
  rerender({ time: undefined });
  expect(result.current).toBe(anchor);
  rerender({ time: NaN });
  expect(result.current).toBe(anchor);
});

test("a time that isn't a finite number draws every day alike", () => {
  const start = Date.UTC(2026, 10, 20);
  const { container } = render(
    <RangeOutlook week={start} extremes={week(start)} units="feet" time={NaN} timezone="UTC" />,
  );
  const bars = [...container.querySelectorAll<HTMLElement>("[style]")];
  expect(new Set(bars.map((b) => b.style.opacity))).toEqual(new Set(["1"]));
});
