import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TideStation } from "../../src/components/TideStation.js";
import { addDays, dateKey, dayStartOf, localNoon, startOfDay } from "../../src/utils/time.js";
import { createTestWrapper, holdRequests } from "../helpers.js";

const SEATTLE = "noaa/9447130";
const TZ = "America/Los_Angeles";

// The strip's moves land directly, so a busy page can't stall a glide past the rest delay.
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderStation(id = SEATTLE, wrapper = createTestWrapper()) {
  const view = render(<TideStation id={id} className="extra" />, { wrapper });
  const slider = await screen.findByRole("slider", { name: "Tide timeline" }, { timeout: 10000 });
  return { ...view, slider };
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
    /\d ft(High|Low)$/.test(b.textContent ?? ""),
  );
const weekBar = () => screen.getByRole("button", { name: /^Showing .+\. Choose a date\.$/ });

describe("TideStation", () => {
  test("is busy while loading", () => {
    const { container } = render(<TideStation id={SEATTLE} />, { wrapper: createTestWrapper() });
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  test("shows the station, its strip, the week's turns and where they come from", async () => {
    const { container } = await renderStation();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Seattle");
    expect(container.querySelector("section.extra")).not.toBeNull();
    expect(weekBar()).toBeDefined();
    const today = screen.getByRole("button", { name: /^Today/ });
    expect(today.getAttribute("aria-expanded")).toBe("true");
    expect(rows(container).length).toBeGreaterThan(2);
    expect(container.querySelectorAll("[aria-current='true']").length).toBe(1);
    expect(screen.getByText("Predictions — not for navigation")).toBeDefined();
    expect(screen.getByText("MLLW chart datum. NOAA harmonic prediction.")).toBeDefined();

    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText("MLLW (NOAA chart datum)")).toBeDefined();
    expect(screen.getByText(SEATTLE)).toBeDefined();
    expect(screen.getByText(TZ)).toBeDefined();
    expect(screen.getByText(/^47\.\d{3}°N, 122\.\d{3}°W$/)).toBeDefined();
  });

  test("asks for the API's default datum, whatever an older release saved", async () => {
    localStorage.setItem("slackwater-settings", JSON.stringify({ datum: "MSL" }));
    const fetch = vi.spyOn(window, "fetch");
    await renderStation();

    const predictions = fetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((u) => /\/(timeline|extremes)$/.test(u.pathname));
    // The week's timeline and extremes, and the fortnight the Range tile ranks against.
    expect(predictions.filter((u) => u.pathname.includes(`/${SEATTLE}/`)).length).toBe(3);
    for (const url of predictions) expect(url.searchParams.has("datum")).toBe(false);
    expect(screen.getByText("MLLW chart datum. NOAA harmonic prediction.")).toBeDefined();
  });

  test("a station without a chart datum shows its tide and makes no datum claim", async () => {
    // Fort Wadsworth has constituents but no datums, so a datum asked for by name fails.
    localStorage.setItem("slackwater-settings", JSON.stringify({ datum: "MLLW" }));
    const { container, slider } = await renderStation("noaa/8519024");

    expect(screen.getByText("NOAA harmonic prediction.")).toBeDefined();
    // Its heights are about mean sea level, so the strip marks nothing at 0.
    const strip = slider.closest("section > div")!;
    expect(strip.querySelector("[data-fill='below-datum']")).toBeNull();
    expect(strip.querySelector('line[stroke-dasharray="1 3"]')).toBeNull();
    fireEvent.click(screen.getByText("Station details"));
    const details = container.querySelector("details")!;
    expect(within(details).getByText("noaa/8519024")).toBeDefined();
    expect(within(details).queryByText("Datum")).toBeNull();
    expect(details.textContent).not.toMatch(/datum/i);
  });

  test("a row moves the strip to its turn, and the highlight follows", async () => {
    const { container, slider } = await renderStation();
    const target = rows(container).find((r) => r.getAttribute("aria-current") !== "true")!;

    fireEvent.click(target);
    await waitFor(
      () => {
        expect(text(slider)).toMatch(/^(High|Low) /);
        expect(target.getAttribute("aria-current")).toBe("true");
      },
      { timeout: 4000 },
    );
  });

  test("the Range tile follows the selection, ranked against one fortnight's fetch", async () => {
    const fetch = vi.spyOn(window, "fetch");
    const { container, slider } = await renderStation();
    const tile = (label: string) =>
      [...container.querySelectorAll(".sw-card")].find((t) => t.textContent!.startsWith(label))!;
    const marks = /^(the fortnight's biggest|beyond normal here)$/;
    const caption = () => tile("Range").querySelector("p")!.textContent!;

    for (const kind of ["High", "Low"]) {
      fireEvent.click(rows(container).find((r) => r.textContent!.endsWith(kind))!);
      const direction = kind === "High" ? "high to low" : "low to high";
      await waitFor(() => expect(caption()).toMatch(new RegExp(`^${direction}$|${marks.source}`)), {
        timeout: 4000,
      });
      expect(tile("Range").textContent).toMatch(/^Range\d+\.\d ft/);
    }
    expect(tile("Moon").textContent).toMatch(
      /^Moon(New|Full) Moon|(Waxing|Waning) |(First|Last) Q/,
    );

    // A new week loads a new window, but the fortnight stays the one from the page's opening.
    const picked = dayStartOf(dateKey(addDays(startOfDay(Date.now(), TZ), 21, TZ), TZ), TZ);
    const input = container.querySelector<HTMLInputElement>("input[type='date']")!;
    fireEvent.change(input, { target: { value: dateKey(picked, TZ) } });
    await waitFor(() => expect(value(slider)).toBe(localNoon(picked, TZ)), { timeout: 10000 });
    const DAY = 86_400_000;
    const fortnights = fetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((u) => u.pathname.endsWith(`${SEATTLE}/extremes`))
      .filter((u) => {
        const span =
          Date.parse(u.searchParams.get("end")!) - Date.parse(u.searchParams.get("start")!);
        return span > 29 * DAY;
      });
    expect(fortnights.length).toBe(1);
  });

  test("one day is open at a time", async () => {
    await renderStation();
    const today = screen.getByRole("button", { name: /^Today/ });
    const tomorrow = screen.getByRole("button", { name: /^Tomorrow/ });
    expect(tomorrow.getAttribute("aria-expanded")).toBe("false");
    expect(within(tomorrow).getByText("Sunrise")).toBeDefined();

    fireEvent.click(tomorrow);
    expect(tomorrow.getAttribute("aria-expanded")).toBe("true");
    expect(today.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Solar noon")).toBeDefined();

    fireEvent.click(tomorrow);
    expect(tomorrow.getAttribute("aria-expanded")).toBe("false");
  });

  test("picking a date moves the week and the strip, and Now brings both back", async () => {
    const { container, slider } = await renderStation();
    const before = weekBar().ariaLabel;
    const picked = dayStartOf(dateKey(addDays(startOfDay(Date.now(), TZ), 21, TZ), TZ), TZ);
    const input = container.querySelector<HTMLInputElement>("input[type='date']")!;

    fireEvent.click(weekBar());
    fireEvent.change(input, { target: { value: dateKey(picked, TZ) } });
    expect(weekBar().ariaLabel).not.toBe(before);
    await waitFor(
      () => {
        expect(value(slider)).toBe(localNoon(picked, TZ));
        // The timeline and the extremes arrive separately.
        const firstDay = container.querySelector("button[aria-expanded]")!;
        expect(firstDay.ariaExpanded).toBe("true");
        expect(firstDay.textContent).not.toMatch(/^Today/);
      },
      { timeout: 10000 },
    );

    const now = await screen.findByRole("button", { name: "Return to now" }, { timeout: 4000 });
    await waitFor(() => expect(now.tabIndex).toBe(0), { timeout: 4000 });
    fireEvent.click(now);
    await waitFor(() => expect(Math.abs(value(slider) - Date.now())).toBeLessThan(60_000), {
      timeout: 10000,
    });
    expect(weekBar().ariaLabel).toBe(before);
  });

  test("a date already on the strip keeps the selection", async () => {
    const { container, slider } = await renderStation();
    await waitFor(() => expect(Math.abs(value(slider) - Date.now())).toBeLessThan(60_000), {
      timeout: 4000,
    });
    const tomorrow = addDays(startOfDay(Date.now(), TZ), 1, TZ);
    const selected = value(slider);

    fireEvent.change(container.querySelector("input[type='date']")!, {
      target: { value: dateKey(tomorrow, TZ) },
    });
    expect(screen.getByRole("button", { name: /^Tomorrow/ }).ariaExpanded).toBe("true");
    expect(value(slider)).toBe(selected);
    fireEvent.change(container.querySelector("input[type='date']")!, { target: { value: "" } });
    fireEvent.change(container.querySelector("input[type='date']")!, {
      target: { value: dateKey(Date.now(), TZ) },
    });
    expect(screen.getByRole("button", { name: /^Today/ }).ariaExpanded).toBe("true");
  });

  test("a subordinate station names its reference", async () => {
    await renderStation("noaa/9440597");

    expect(
      await screen.findByText(
        /^MLLW chart datum\. Based on .+ tides and NOAA's published offsets\.$/,
        undefined,
        { timeout: 10000 },
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Station details"));
    // The reference station is its own request to the shared test API.
    expect(await screen.findByText(/, \d+ km away$/, undefined, { timeout: 10000 })).toBeDefined();
  });

  test("credits a station's own source", async () => {
    await renderStation("kartverket/BGO");

    expect(screen.getByText(/^CD chart datum\. Harmonic constants from Kartverket/)).toBeDefined();
    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText("CD chart datum")).toBeDefined();
  });

  test("ends with the nearest stations of both kinds, and says which was picked", async () => {
    const onStationSelect = vi.fn();
    render(<TideStation id="noaa/9448614" onStationSelect={onStationSelect} />, {
      wrapper: createTestWrapper(),
    });

    const nearby = await screen.findByRole("region", { name: "Nearby" }, { timeout: 10000 });
    const items = await within(nearby).findAllByRole("listitem", undefined, { timeout: 10000 });
    expect(items.length).toBe(6);
    expect(nearby.textContent).not.toContain("Deception Pass St. Park");
    fireEvent.click(within(nearby).getByRole("button", { name: /^Deception Pass \(Narrows\)/ }));
    expect(onStationSelect.mock.calls[0][0]).toMatchObject({ id: "noaa/PUG1701", kind: "current" });
  });

  test("explains a station whose predictions can't be served, without asking for them", async () => {
    const fetch = vi.spyOn(window, "fetch");
    render(<TideStation id="chs-campbell-river" />, { wrapper: createTestWrapper() });

    expect(await screen.findByText(/terms do not allow them to be redistributed/)).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Campbell River");
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByText("Station details")).toBeNull();
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => /\/(timeline|extremes)\?/.test(u) && u.includes("chs-"))).toEqual([]);
  });

  test("a new station starts over rather than showing the last one's strip", async () => {
    const { rerender } = await renderStation();
    const next = "noaa/9448614";
    const timeline = holdRequests((u) => u.includes(`/${next}/timeline?`));

    rerender(<TideStation id={next} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Deception Pass St. Park" }),
    ).toBeDefined();
    expect(screen.queryByRole("slider")).toBeNull();
    timeline.release();
    expect(await screen.findByRole("slider", undefined, { timeout: 10000 })).toBeDefined();
  });

  test("explains an unservable station with no reason given", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({ name: "Nowhere Harbour", timezone: "UTC", predictions: false }),
    );
    render(<TideStation id="test/nowhere" />, { wrapper: createTestWrapper() });

    expect(await screen.findByText("Predictions aren't available for this station.")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nowhere Harbour");
  });

  test("shows a fetch error", async () => {
    const { container } = render(<TideStation id="noaa/0000000" />, {
      wrapper: createTestWrapper(),
    });

    await screen.findByText(/not found/i, undefined, { timeout: 10000 });
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });
});

function value(slider: HTMLElement) {
  return Number(slider.getAttribute("aria-valuenow"));
}

function text(slider: HTMLElement) {
  return slider.getAttribute("aria-valuetext") ?? "";
}
