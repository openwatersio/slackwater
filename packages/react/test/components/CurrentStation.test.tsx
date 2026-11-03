import { afterEach, describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CurrentStation } from "../../src/components/CurrentStation.js";
import { createTestWrapper } from "../helpers.js";

afterEach(() => {
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

  test("explains a station whose predictions can't be served", async () => {
    render(<CurrentStation id="chs-active-pass" />, { wrapper: createTestWrapper() });

    const heading = await screen.findByRole("heading", { level: 1, name: /Active Pass/ });
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
});
