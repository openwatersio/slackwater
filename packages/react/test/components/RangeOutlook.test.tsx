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
import { outlookWindow } from "../../src/utils/standing.js";

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
  // Silent until its week loads, then spoken.
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  await waitFor(
    () => expect(screen.getByRole("img", { name: /^Daily tide ranges:/ })).toBeDefined(),
    { timeout: 10000 },
  );
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

test("without its highs and lows it keeps its size and says nothing", () => {
  const start = Date.UTC(2026, 10, 20);
  const { container } = render(<RangeOutlook week={start} units="feet" timezone="UTC" />);
  const box = container.firstElementChild!;
  expect(box.getAttribute("aria-hidden")).toBe("true");
  expect(box.getAttribute("aria-label")).toBeNull();
  expect(box.getAttribute("role")).toBeNull();
  expect(box.getBoundingClientRect().height).toBe(62);
});

test("with no moment, every day is drawn alike", () => {
  const start = Date.UTC(2026, 10, 20);
  const { container } = render(
    <RangeOutlook week={start} extremes={week(start)} units="feet" timezone="UTC" />,
  );
  const bars = [...container.querySelectorAll<HTMLElement>("[style]")];
  expect(new Set(bars.map((b) => b.style.opacity))).toEqual(new Set(["1"]));
});

test("a week that fails to load speaks its days as unavailable", async () => {
  const timezone = "America/Los_Angeles";
  const anchor = startOfDay(Date.now(), timezone);
  render(
    <StationRangeOutlook id="noaa/9447130" anchor={anchor} time={anchor} timezone={timezone} />,
    { wrapper: createTestWrapper({ baseUrl: "http://127.0.0.1:9" }) },
  );
  await waitFor(
    () =>
      expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
        /^Daily tide ranges: (\w+, \w+ \d+: unavailable(; )?){7}$/,
      ),
    { timeout: 10000 },
  );
});

test("any moment in the first day stands for its station-local start", () => {
  const tz = "America/Los_Angeles";
  const midnight = Date.parse("2026-11-20T08:00:00Z");
  // 4 AM PST on Nov 20, hours after that day's midnight.
  const early = Date.UTC(2026, 10, 20) + 12 * H;
  const { result } = renderHook(() => useOutlookWeek(early, undefined, tz));
  expect(result.current).toBe(midnight);
  expect(outlookWindow(early, tz)).toEqual(outlookWindow(midnight, tz));
  const drawn = (start: number) =>
    render(
      <RangeOutlook
        week={start}
        extremes={week(midnight)}
        units="feet"
        timezone={tz}
        locale="en-US"
      />,
    ).container.firstElementChild!.getAttribute("aria-label");
  expect(drawn(midnight + 15 * H)).toBe(drawn(midnight));
  expect(drawn(midnight)).toMatch(/^Daily tide ranges: Friday, Nov 20: \d/);
});

test("a moment at the far ends of the Date range reads as none", () => {
  const start = Date.UTC(2026, 10, 20);
  for (const time of [1e16, -1e16, 8.64e15]) {
    const { container, unmount } = render(
      <RangeOutlook week={start} extremes={week(start)} units="feet" time={time} timezone="UTC" />,
    );
    const bars = [...container.querySelectorAll<HTMLElement>("[style]")];
    expect(new Set(bars.map((b) => b.style.opacity))).toEqual(new Set(["1"]));
    unmount();
    const { result } = renderHook(() => useOutlookWeek(start, time, "UTC"));
    expect(result.current).toBe(start);
  }
});

test("the week holds through its fifth day, starts on the moment's day from its sixth, and is the anchor with no moment", () => {
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
