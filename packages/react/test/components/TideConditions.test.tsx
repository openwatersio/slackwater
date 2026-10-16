import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TideConditions } from "../../src/components/TideConditions.js";
import { cardRange } from "../../src/utils/card.js";
import { createTestWrapper } from "../helpers.js";
import type { Extreme, TimelineEntry } from "../../src/types.js";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-15T19:00:00Z");
const PERIOD = 12.42 * HOUR;

// A clean semidiurnal tide with a high at NOW + 3 h, sampled every 10 minutes for a day either side.
const level = (t: number) => 1.5 + 1.5 * Math.cos(((t - NOW - 3 * HOUR) / PERIOD) * 2 * Math.PI);
const timeline: TimelineEntry[] = Array.from({ length: 289 }, (_, i) => {
  const t = NOW - 24 * HOUR + i * 600_000;
  return { time: new Date(t), level: level(t) };
});
const extremes: Extreme[] = [-3, -1, 0, 1, 2].map((k) => {
  const t = NOW + 3 * HOUR + (k * PERIOD) / 2;
  const high = k % 2 === 0;
  return { time: new Date(t), level: level(t), high, low: !high, label: high ? "High" : "Low" };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TideConditions", () => {
  test("names the station and reads the height with its direction", () => {
    render(
      <TideConditions
        name="Seattle"
        timeline={timeline}
        extremes={extremes}
        units="meters"
        timezone="America/Los_Angeles"
        now={NOW}
      />,
      { wrapper: createTestWrapper({ locale: "en-US" }) },
    );

    expect(screen.getByText("Seattle")).toBeDefined();
    expect(screen.getByText(`${level(NOW).toFixed(2)} metres, rising`)).toBeDefined();
    expect(screen.queryByText("Rising")).toBeNull();
  });

  test("draws half a swing back to a swing and a half ahead, naming the turns in it", () => {
    render(
      <TideConditions
        timeline={timeline}
        extremes={extremes}
        units="meters"
        timezone="America/Los_Angeles"
        now={NOW}
      />,
      { wrapper: createTestWrapper({ locale: "en-US" }) },
    );

    // The high at +3 h and the low after it; the turns outside the span go unspoken.
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "12-hour curve: 3.00 m at 3:00 PM, 0.00 m at 9:12 PM",
    );
  });

  test("falls toward a low", () => {
    render(
      <TideConditions
        timeline={timeline}
        extremes={extremes}
        units="feet"
        timezone="UTC"
        now={NOW + 4 * HOUR}
      />,
      { wrapper: createTestWrapper() },
    );
    expect(screen.getByText(/ feet, falling$/)).toBeDefined();
  });

  test("is the small widget's 170 px, or the parent's height with fill", () => {
    const props = { timeline, extremes, units: "feet" as const, timezone: "UTC", now: NOW };
    const { container, rerender } = render(<TideConditions {...props} className="tile" />, {
      wrapper: createTestWrapper(),
    });
    const frame = container.querySelector<HTMLElement>(".tile")!;
    expect(frame.getBoundingClientRect().height).toBe(170);

    rerender(
      <div style={{ height: 240 }}>
        <TideConditions {...props} className="tile" fill />
      </div>,
    );
    expect(container.querySelector<HTMLElement>(".tile")!.getBoundingClientRect().height).toBe(240);
  });

  test("says when there is nothing to show", () => {
    render(<TideConditions timeline={[]} extremes={[]} units="feet" timezone="UTC" />, {
      wrapper: createTestWrapper(),
    });
    expect(screen.getByText("No tide predictions for this period.")).toBeDefined();
  });

  test("fetches a station's card window and names it", async () => {
    const fetch = vi.spyOn(window, "fetch");
    const { container } = render(<TideConditions id="noaa/9447130" now={NOW} />, {
      wrapper: createTestWrapper(),
    });

    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(await screen.findByText("Seattle", undefined, { timeout: 10000 })).toBeDefined();
    expect(screen.getByRole("img", { name: /^12-hour curve/ })).toBeDefined();
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    const extremesUrl = urls.find((u) => u.pathname.endsWith("/extremes"))!;
    expect(extremesUrl.searchParams.get("end")).toBe(cardRange(NOW).extremes.end);
  });

  test("shows a failed fetch", async () => {
    render(<TideConditions id="noaa/0000000" now={NOW} />, { wrapper: createTestWrapper() });
    expect(await screen.findByText(/not found/i, undefined, { timeout: 10000 })).toBeDefined();
  });
});
