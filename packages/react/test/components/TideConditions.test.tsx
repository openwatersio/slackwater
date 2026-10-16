import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
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

// The same tide about mean sea level, crossing 0 every swing.
const msl = timeline.map((p) => ({ ...p, level: p.level - 1.5 }));
const mslExtremes = extremes.map((e) => ({ ...e, level: e.level - 1.5 }));

const amber = (c: Element) =>
  [...c.querySelectorAll("stop")].some(
    (s) =>
      s.getAttribute("stop-color")!.includes("graph-low") &&
      Number(s.getAttribute("stop-opacity")) > 0,
  );
const datumLine = (c: Element) => c.querySelector('line[stroke-dasharray="1 3"]');

/** The water's floor and the lowest the curve goes on screen, in SVG y (down is larger). */
function waterFloor(c: Element) {
  const svg = c.querySelector("svg")!;
  const width = Number(svg.getAttribute("width"));
  const points = (d: string) =>
    [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({ x: +x, y: +y }));
  // The area closes along its floor after the curve, past both edges.
  const area = points(svg.querySelector("path[fill$='fill)']")!.getAttribute("d")!);
  const curve = points(svg.querySelector("path[stroke$='line)']")!.getAttribute("d")!);
  const onScreen = curve.filter((p) => p.x >= 0 && p.x <= width).map((p) => p.y);
  return { floor: area[area.length - 1].y, lowest: Math.max(...onScreen) };
}

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

  test("shades amber below chart datum and marks it with a line", () => {
    const { container } = render(
      <TideConditions
        timeline={msl}
        extremes={mslExtremes}
        units="meters"
        timezone="UTC"
        now={NOW}
      />,
      { wrapper: createTestWrapper() },
    );
    expect(amber(container)).toBe(true);
    expect(datumLine(container)).not.toBeNull();
  });

  test("without a chart datum leaves 0 unmarked and fills only under the curve", () => {
    const { container } = render(
      <TideConditions
        timeline={msl}
        extremes={mslExtremes}
        units="meters"
        timezone="UTC"
        now={NOW}
        chartDatum={false}
      />,
      { wrapper: createTestWrapper() },
    );
    expect(amber(container)).toBe(false);
    expect(datumLine(container)).toBeNull();
    const { floor, lowest } = waterFloor(container);
    expect(floor).toBeGreaterThanOrEqual(lowest);
  });

  test("a fetched station without a chart datum leaves 0 unmarked", async () => {
    // Fort Wadsworth's heights are about mean sea level, so its curve crosses 0.
    render(<TideConditions id="noaa/8519024" now={NOW} />, { wrapper: createTestWrapper() });
    const graph = await screen.findByRole("img", { name: /^12-hour curve/ }, { timeout: 10000 });
    expect(amber(graph)).toBe(false);
    expect(datumLine(graph)).toBeNull();
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

  test("gives an unservable station's reason without asking for its predictions", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<TideConditions id="chs-campbell-river" now={NOW} />, {
      wrapper: createTestWrapper({ queryClient }),
    });

    expect(
      await screen.findByText(/^Predictions for Campbell River .+ redistributed/, undefined, {
        timeout: 10000,
      }),
    ).toBeDefined();
    const asked = queryClient
      .getQueryCache()
      .getAll()
      .filter(
        (q) =>
          q.state.fetchStatus !== "idle" || q.state.dataUpdateCount + q.state.errorUpdateCount > 0,
      )
      .map((q) => q.queryKey[1]);
    expect(asked).toEqual(["station"]);
  });

  test("explains an unservable station with no reason given", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({ name: "Nowhere", timezone: "UTC", predictions: false }),
    );
    render(<TideConditions id="test/nowhere" now={NOW} />, { wrapper: createTestWrapper() });

    expect(await screen.findByText("Predictions aren't available for this station.")).toBeDefined();
  });

  test("shows a failed fetch", async () => {
    render(<TideConditions id="noaa/0000000" now={NOW} />, { wrapper: createTestWrapper() });
    expect(await screen.findByText(/not found/i, undefined, { timeout: 10000 })).toBeDefined();
  });
});
