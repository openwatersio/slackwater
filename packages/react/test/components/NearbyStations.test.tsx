import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NearbyStations } from "../../src/components/NearbyStations.js";
import { createTestWrapper } from "../helpers.js";

const DECEPTION_PASS = { latitude: 48.4062, longitude: -122.6431 };

afterEach(() => {
  vi.restoreAllMocks();
});

async function cards() {
  const list = await screen.findByRole("list", undefined, { timeout: 10000 });
  return within(list).getAllByRole("listitem");
}

const names = (items: HTMLElement[]) =>
  items.map((li) => li.querySelector(".truncate")!.textContent);
const distances = (items: HTMLElement[]) =>
  items.map((li) => Number(/([\d.]+) nm/.exec(li.textContent!)![1]));

describe("NearbyStations", () => {
  test("is busy while it finds the stations", () => {
    render(<NearbyStations {...DECEPTION_PASS} />, { wrapper: createTestWrapper() });
    expect(screen.getByRole("status").textContent).toBe("Loading nearby stations");
  });

  test("lists tide and current stations together, nearest first, with their distance", async () => {
    render(<NearbyStations {...DECEPTION_PASS} maxResults={4} />, { wrapper: createTestWrapper() });

    const items = await cards();
    expect(names(items)).toEqual([
      "Deception Pass (Narrows)",
      "Deception Pass St. Park",
      "Cornet Bay",
      "Yokeko Point",
    ]);
    const nm = distances(items);
    expect([...nm].sort((a, b) => a - b)).toEqual(nm);
  });

  test("leaves out the tide station it is measured from", async () => {
    render(<NearbyStations stationId="noaa/9448614" maxResults={3} />, {
      wrapper: createTestWrapper(),
    });

    const items = await cards();
    expect(items.length).toBe(3);
    expect(names(items)).not.toContain("Deception Pass St. Park");
    expect(names(items)).toContain("Deception Pass (Narrows)");
  });

  test("leaves out the current station it is measured from", async () => {
    render(<NearbyStations stationId="noaa/PUG1701" kind="current" maxResults={3} />, {
      wrapper: createTestWrapper(),
    });

    const items = await cards();
    expect(names(items)).toEqual(["Deception Pass St. Park", "Cornet Bay", "Yokeko Point"]);
  });

  test("leaves out a depth bin's station by its listed id", async () => {
    render(<NearbyStations stationId="noaa/EPT0003@11" kind="current" maxResults={4} />, {
      wrapper: createTestWrapper(),
    });

    const items = await cards();
    expect(items.length).toBe(4);
    expect(names(items)).not.toContain("Estes Head");
  });

  test("calls back with the picked station and its kind, and on hover and focus", async () => {
    const onStationSelect = vi.fn();
    const onHover = vi.fn();
    const onHoverEnd = vi.fn();
    render(
      <NearbyStations
        {...DECEPTION_PASS}
        maxResults={2}
        onStationSelect={onStationSelect}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
      />,
      { wrapper: createTestWrapper() },
    );

    const [first, second] = await cards();
    fireEvent.click(within(first).getByRole("button"));
    expect(onStationSelect.mock.calls[0][0]).toMatchObject({ id: "noaa/PUG1701", kind: "current" });

    fireEvent.mouseEnter(second);
    expect(onHover.mock.calls[0][0]).toMatchObject({ id: "noaa/9448614", kind: "tide" });
    fireEvent.mouseLeave(second);
    expect(onHoverEnd.mock.calls[0][0]).toMatchObject({ id: "noaa/9448614" });
    fireEvent.focus(within(first).getByRole("button"));
    expect(onHover.mock.calls[1][0]).toMatchObject({ id: "noaa/PUG1701" });
    fireEvent.blur(within(first).getByRole("button"));
    expect(onHoverEnd).toHaveBeenCalledTimes(2);
  });

  test("still lists tide stations from an API without the current routes", async () => {
    const real = window.fetch.bind(window);
    vi.spyOn(window, "fetch").mockImplementation((input, init) =>
      String(input).includes("/currents/")
        ? Promise.resolve(new Response(JSON.stringify({ message: "Not found" }), { status: 404 }))
        : real(input, init),
    );
    render(<NearbyStations {...DECEPTION_PASS} maxResults={2} />, { wrapper: createTestWrapper() });

    expect(names(await cards())).toEqual(["Deception Pass St. Park", "Cornet Bay"]);
  });

  test("says why when nothing loads", async () => {
    render(<NearbyStations stationId="noaa/0000000" />, { wrapper: createTestWrapper() });
    expect(await screen.findByText(/not found/i, undefined, { timeout: 10000 })).toBeDefined();
  });

  test("says why when neither list loads", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Down for maintenance" }), { status: 503 }),
    );
    render(<NearbyStations {...DECEPTION_PASS} />, { wrapper: createTestWrapper() });
    expect(await screen.findByText("Down for maintenance")).toBeDefined();
  });

  test("applies className to the list", async () => {
    render(<NearbyStations {...DECEPTION_PASS} className="my-list" />, {
      wrapper: createTestWrapper(),
    });
    expect((await screen.findByRole("list", undefined, { timeout: 10000 })).className).toContain(
      "my-list",
    );
  });
});
