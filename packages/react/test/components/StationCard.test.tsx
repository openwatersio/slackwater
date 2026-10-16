import { afterEach, describe, expect, inject, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StationCard, type CardStation } from "../../src/components/StationCard.js";
import { fetchCurrentStationEvents } from "../../src/client.js";
import { cardRange } from "../../src/utils/card.js";
import { createTestWrapper } from "../helpers.js";

const NOW = Date.parse("2026-10-15T19:00:00Z");

const seattle: CardStation = {
  id: "noaa/9447130",
  name: "Seattle",
  region: "WA",
  country: "United States",
  continent: "Americas",
  latitude: 47.6026,
  longitude: -122.3393,
  timezone: "America/Los_Angeles",
  type: "reference",
  kind: "tide",
};

const deceptionPass: CardStation = {
  id: "noaa/PUG1701",
  name: "Deception Pass (Narrows)",
  region: "Washington",
  country: "United States",
  continent: "Americas",
  latitude: 48.4062,
  longitude: -122.6431,
  timezone: "America/Los_Angeles",
  type: "reference",
  kind: "current",
  predictions: true,
};

const curve = () => screen.findByRole("img", { name: /^25-hour curve/ }, { timeout: 10000 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StationCard", () => {
  test("reads a tide station's height and direction over its curve", async () => {
    render(<StationCard station={seattle} now={NOW} />, {
      wrapper: createTestWrapper({ units: "feet" }),
    });

    const graph = await curve();
    expect(screen.getByText("Seattle")).toBeDefined();
    expect(screen.getByText("WA")).toBeDefined();
    expect(screen.getByText(/^-?\d+\.\d feet, (rising|falling)$/)).toBeDefined();
    // The curve names the turns in its span, with their times.
    expect(graph.getAttribute("aria-label")).toMatch(/: -?\d+\.\d ft at \d+:\d\d [AP]M/);
    expect(screen.queryByText(/nm$/)).toBeNull();
  });

  test("loads its window around now at the API's default datum, as the station page does", async () => {
    localStorage.setItem("slackwater-settings", JSON.stringify({ datum: "MSL" }));
    const fetch = vi.spyOn(window, "fetch");
    render(<StationCard station={seattle} now={NOW} />, { wrapper: createTestWrapper() });
    await curve();

    const range = cardRange(NOW);
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    const timeline = urls.find((u) => u.pathname.endsWith(`${seattle.id}/timeline`))!;
    expect(timeline.searchParams.get("start")).toBe(range.timeline.start);
    expect(timeline.searchParams.get("end")).toBe(range.timeline.end);
    const predictions = urls.filter((u) => /\/(timeline|extremes)$/.test(u.pathname));
    expect(predictions.length).toBeGreaterThan(0);
    for (const url of predictions) expect(url.searchParams.has("datum")).toBe(false);
  });

  test("a station without a chart datum leaves 0 unmarked", async () => {
    // Fort Wadsworth's heights are about mean sea level, so its curve crosses 0.
    const fortWadsworth = { ...seattle, id: "noaa/8519024", name: "Fort Wadsworth" };
    render(<StationCard station={fortWadsworth} now={NOW} />, { wrapper: createTestWrapper() });

    const graph = await curve();
    const amber = [...graph.querySelectorAll("stop")].filter(
      (s) =>
        s.getAttribute("stop-color")!.includes("graph-low") &&
        Number(s.getAttribute("stop-opacity")) > 0,
    );
    expect(amber).toEqual([]);
    expect(graph.querySelector('line[stroke-dasharray="1 3"]')).toBeNull();
  });

  test("reads a current's speed, state, and set", async () => {
    render(<StationCard station={deceptionPass} now={NOW} />, { wrapper: createTestWrapper() });

    await curve();
    expect(
      screen.getByText(/^\d+\.\d knots, (flooding|ebbing), setting [NESW]{1,3}$/),
    ).toBeDefined();
  });

  test("says Slack on a slack", async () => {
    const range = cardRange(NOW).timeline;
    const { events } = await fetchCurrentStationEvents(inject("apiBaseUrl"), {
      id: deceptionPass.id,
      ...range,
    });
    const slack = events.find((e) => e.kind === "slack" && e.time.getTime() > NOW)!.time.getTime();
    render(<StationCard station={deceptionPass} now={slack} />, { wrapper: createTestWrapper() });

    await curve();
    expect(screen.getByText(/^\d+\.\d knots, slack$/)).toBeDefined();
    expect(screen.getByText("Slack")).toBeDefined();
  });

  test("shows a nearby list's distance in nautical miles", () => {
    render(<StationCard station={seattle} distance={2.2224} now={NOW} />, {
      wrapper: createTestWrapper(),
    });
    expect(screen.getByText("1.2 nm")).toBeDefined();
  });

  test("is a button that calls back with the station, kind and all", () => {
    const onSelect = vi.fn();
    render(<StationCard station={deceptionPass} onSelect={onSelect} now={NOW} />, {
      wrapper: createTestWrapper(),
    });

    fireEvent.click(screen.getByRole("button", { name: /^Deception Pass \(Narrows\)/ }));
    expect(onSelect).toHaveBeenCalledWith(deceptionPass);
    expect(onSelect.mock.calls[0][0].kind).toBe("current");
  });

  test("is a link with an href, and plain without either", () => {
    const { container, rerender } = render(
      <StationCard station={seattle} href="/stations/seattle" now={NOW} />,
      { wrapper: createTestWrapper() },
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/stations/seattle");

    rerender(<StationCard station={seattle} now={NOW} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toContain("Seattle");
  });

  test("with an href and onSelect, a plain click selects in place of the link and a modified one opens it", () => {
    // Records whether the card kept the link, then stops the test page navigating either way.
    const followed: boolean[] = [];
    const record = (e: Event) => {
      followed.push(!e.defaultPrevented);
      e.preventDefault();
    };
    window.addEventListener("click", record);
    const onSelect = vi.fn();
    render(
      <StationCard station={seattle} href="/stations/seattle" onSelect={onSelect} now={NOW} />,
      { wrapper: createTestWrapper() },
    );
    const link = screen.getByRole("link");

    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith(seattle);
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(link, init);
    }
    window.removeEventListener("click", record);
    expect(followed).toEqual([false, true, true, true, true, true]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("names a station it can't serve without loading predictions", () => {
    const fetch = vi.spyOn(window, "fetch");
    render(
      <StationCard
        station={{
          ...deceptionPass,
          id: "chs-active-pass",
          name: "Active Pass",
          predictions: false,
        }}
        now={NOW}
      />,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByText("Predictions aren't available for this station.")).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("loads at once where there's no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const fetch = vi.spyOn(window, "fetch");
    render(<StationCard station={seattle} now={NOW} />, { wrapper: createTestWrapper() });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  test("shows a failed load in place of the reading", async () => {
    render(<StationCard station={{ ...seattle, id: "noaa/0000000" }} now={NOW} />, {
      wrapper: createTestWrapper(),
    });
    expect(await screen.findByText(/not found/i, undefined, { timeout: 10000 })).toBeDefined();
  });

  test("waits to load until it scrolls near the viewport", async () => {
    const fetch = vi.spyOn(window, "fetch");
    render(
      <div>
        <div style={{ height: 4000 }} />
        <StationCard station={seattle} now={NOW} />
      </div>,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByText("Loading")).toBeDefined();
    await new Promise((r) => setTimeout(r, 300));
    expect(fetch).not.toHaveBeenCalled();

    screen.getByText("Seattle").scrollIntoView();
    await curve();
    expect(fetch).toHaveBeenCalled();
    window.scrollTo(0, 0);
  });

  test("follows the clock when none is given", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetch = vi.spyOn(window, "fetch");
    render(<StationCard station={seattle} />, { wrapper: createTestWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const start = new URL(String(fetch.mock.calls[0][0])).searchParams.get("start");
    expect(start).toBe(cardRange(NOW).timeline.start);
  });
});
