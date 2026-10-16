import { afterEach, describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CurrentStation } from "../../src/components/CurrentStation.js";
import { createTestWrapper, holdRequests } from "../helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CurrentStation", () => {
  test("is busy while loading", () => {
    const { container } = render(<CurrentStation id="noaa/PUG1701" />, {
      wrapper: createTestWrapper(),
    });

    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  test("renders the station and its scrubber", async () => {
    render(<CurrentStation id="noaa/PUG1701" threshold={0.3} className="extra" />, {
      wrapper: createTestWrapper(),
    });

    expect(
      await screen.findByRole("slider", { name: "Current timeline" }, { timeout: 10000 }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent!.trim()).not.toBe("");
  });

  test("a new station starts over rather than showing the last one's strip", async () => {
    const { rerender } = render(<CurrentStation id="noaa/PUG1701" />, {
      wrapper: createTestWrapper(),
    });
    await screen.findByRole("slider", { name: "Current timeline" }, { timeout: 10000 });
    const timeline = holdRequests((u) => u.includes("/noaa/PUG1515/timeline?"));

    rerender(<CurrentStation id="noaa/PUG1515" />);

    expect(await screen.findByRole("heading", { level: 1, name: "West Point" })).toBeDefined();
    expect(screen.queryByRole("slider")).toBeNull();
    timeline.release();
    expect(await screen.findByRole("slider", undefined, { timeout: 10000 })).toBeDefined();
  });

  test("ends with the nearest stations of both kinds, without itself", async () => {
    const onStationSelect = vi.fn();
    render(<CurrentStation id="noaa/PUG1701" onStationSelect={onStationSelect} />, {
      wrapper: createTestWrapper(),
    });

    const nearby = await screen.findByRole("region", { name: "Nearby" }, { timeout: 10000 });
    const items = await within(nearby).findAllByRole("listitem", undefined, { timeout: 10000 });
    expect(items.length).toBe(6);
    expect(nearby.textContent).not.toContain("Deception Pass (Narrows)");
    fireEvent.click(within(nearby).getByRole("button", { name: /^Deception Pass St\. Park/ }));
    expect(onStationSelect.mock.calls[0][0]).toMatchObject({ id: "noaa/9448614", kind: "tide" });
  });

  test("explains a station whose predictions can't be served", async () => {
    render(<CurrentStation id="chs-active-pass" />, { wrapper: createTestWrapper() });

    // The shared test API answers slowly while other files load it.
    const heading = await screen.findByRole(
      "heading",
      { level: 1, name: /Active Pass/ },
      { timeout: 10000 },
    );
    expect(heading).toBeDefined();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(await screen.findByText(/terms do not allow them to be redistributed/)).toBeDefined();
  });

  test("explains an unservable station with no reason given", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({
        name: "Nowhere Pass",
        timezone: "UTC",
        predictions: false,
        disclaimers: "Not for navigation.",
        attribution: "Nowhere Survey",
      }),
    );
    render(<CurrentStation id="noaa/NOWHERE" />, { wrapper: createTestWrapper() });

    expect(await screen.findByText("Predictions aren't available for this station.")).toBeDefined();
    expect(screen.getByText("Not for navigation.")).toBeDefined();
    expect(screen.getByText("Nowhere Survey")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nowhere Pass");
  });

  test("shows a fetch error", async () => {
    const { container } = render(<CurrentStation id="noaa/NOPE0000" />, {
      wrapper: createTestWrapper(),
    });

    await screen.findByText(/not found/i, undefined, { timeout: 10000 });
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });

  test("keeps its strip a day on, and moves its window two days on", async () => {
    render(<CurrentStation id="noaa/PUG1701" />, { wrapper: createTestWrapper() });
    const slider = await screen.findByRole("slider", undefined, { timeout: 10000 });
    const start = Number(slider.getAttribute("aria-valuemin"));
    const H = 3_600_000;
    const realNow = Date.now.bind(Date);
    const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 24 * H);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("slider").getAttribute("aria-valuemin")).toBe(String(start));

    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("slider").getAttribute("aria-valuemin")).toBe(String(start));

    now.mockImplementation(() => realNow() + 48 * H);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("slider")).toBe(slider);
    await waitFor(() => expect(Number(slider.getAttribute("aria-valuemin"))).toBe(start + 48 * H), {
      timeout: 10000,
    });
    expect(screen.getByRole("slider")).toBe(slider);
  });

  test("shows a message when the station has no timeline rows", async () => {
    const station = {
      name: "Dry Pass",
      timezone: "UTC",
      latitude: 0,
      longitude: 0,
      predictions: true,
    };
    vi.spyOn(window, "fetch").mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/timeline")) return Response.json({ station, timeline: [] });
      if (path.endsWith("/events")) return Response.json({ station, events: [] });
      return Response.json(station);
    });
    render(<CurrentStation id="noaa/DRY" />, { wrapper: createTestWrapper() });

    expect(await screen.findByText("No current predictions for this period.")).toBeDefined();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  test.each([1920, 2560])("opens on now and returns to it at %i px", async (width) => {
    // The strip's moves land directly, so a busy page can't stall a glide past the rest delay.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    // 01:00 at the station, the hardest hour to center on a wide screen.
    const skew = Date.parse("2026-10-14T08:00:00Z") - Date.now();
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    render(
      <div style={{ width }}>
        <CurrentStation id="noaa/PUG1701" />
      </div>,
      { wrapper: createTestWrapper() },
    );
    const slider = await screen.findByRole("slider", undefined, { timeout: 10000 });
    const offNow = () => Math.abs(Number(slider.getAttribute("aria-valuenow")) - Date.now());
    const nowPill = () => screen.queryByRole("button", { name: "Return to now" });

    await waitFor(
      () => {
        expect(offNow()).toBeLessThan(60_000);
        expect(nowPill()).toBeNull();
      },
      { timeout: 4000 },
    );

    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(offNow()).toBeGreaterThan(60_000);
    fireEvent.click(nowPill()!);
    await waitFor(() => expect(offNow()).toBeLessThan(60_000), { timeout: 4000 });
  });

  test("lists the week's slacks and maxima, and says where they come from", async () => {
    const { container } = render(<CurrentStation id="noaa/PUG1701" />, {
      wrapper: createTestWrapper(),
    });
    await screen.findByRole("slider", undefined, { timeout: 10000 });

    const rows = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(rows.some((r) => /—Slack$/.test(r))).toBe(true);
    const nextMax = [...container.querySelectorAll(".sw-card")].find((t) =>
      t.textContent!.startsWith("Next max"),
    )!;
    expect(nextMax.textContent).toMatch(
      /^Next max\d+\.\d\u00a0kn((Flood|Ebb) at|(Hardest|Strong) (flood|ebb) ·) \d{1,2}:\d\d [AP]M$/,
    );
    expect(rows.some((r) => /\d kn(ESE|E)Flood$/.test(r))).toBe(true);
    expect(rows.some((r) => /\d kn(WNW|W)Ebb$/.test(r))).toBe(true);
    expect(
      screen.getByText("NOAA harmonic current prediction. Flood sets 102°T. Speeds use knots."),
    ).toBeDefined();

    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText("102°T")).toBeDefined();
    expect(screen.getByText("282°T")).toBeDefined();
    expect(screen.getByText("0.6 kn toward ebb")).toBeDefined();
    expect(screen.getByText(/^48\.\d{3}°N, 122\.\d{3}°W$/)).toBeDefined();
  });

  test("a subordinate station names its reference", async () => {
    render(<CurrentStation id="noaa/ACT0091" />, { wrapper: createTestWrapper() });
    await screen.findByRole("slider", undefined, { timeout: 10000 });

    expect(
      await screen.findByText(
        /^NOAA subordinate station: .+'s slacks and maxima, corrected by published offsets\. Flood sets 210°T\.$/,
        undefined,
        { timeout: 10000 },
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText(/, \d+ km away$/)).toBeDefined();
    expect(screen.queryByText("Mean flow")).toBeNull();
  });

  test("a station from another source credits it, and slack-free water says none measured", async () => {
    const station = {
      id: "test/STILL",
      name: "Still Water",
      type: "reference",
      timezone: "UTC",
      latitude: -10,
      longitude: 20,
      predictions: true,
      source: { name: "Test Survey" },
      current: { mean_flow: 0.01 },
    };
    const t = Date.now();
    vi.spyOn(window, "fetch").mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/timeline")) {
        return Response.json({
          station,
          timeline: [-2, 2].map((h) => ({ time: new Date(t + h * 3_600_000), speed: 1 })),
        });
      }
      if (path.endsWith("/events")) return Response.json({ station, events: [] });
      return Response.json(station);
    });
    render(<CurrentStation id="test/STILL" />, { wrapper: createTestWrapper() });

    expect(await screen.findByText("Harmonic constants from Test Survey.")).toBeDefined();
    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText("None measured")).toBeDefined();
    expect(screen.getByText("10.000°S, 20.000°E")).toBeDefined();
  });
});
