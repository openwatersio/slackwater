import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TideStation } from "../../src/components/TideStation.js";
import { addDays, dateKey, dayStartOf, localNoon, startOfDay } from "../../src/utils/time.js";
import { createTestWrapper } from "../helpers.js";

const SEATTLE = "noaa/9447130";
const TZ = "America/Los_Angeles";

afterEach(() => {
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

  test("always predicts at the station's chart datum", async () => {
    const fetch = vi.spyOn(window, "fetch");
    await renderStation(SEATTLE, createTestWrapper({ datum: "MSL" }));

    const urls = fetch.mock.calls.map(([url]) => String(url));
    const predictions = urls.filter((u) => /\/(timeline|extremes)\?/.test(u));
    expect(predictions.length).toBe(2);
    for (const url of predictions) expect(new URL(url).searchParams.get("datum")).toBe("MLLW");
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
    expect(screen.getByText(/, \d+ km away$/)).toBeDefined();
  });

  test("credits a station's own source", async () => {
    await renderStation("kartverket/BGO");

    expect(screen.getByText(/^CD chart datum\. Harmonic constants from Kartverket/)).toBeDefined();
    fireEvent.click(screen.getByText("Station details"));
    expect(screen.getByText("CD chart datum")).toBeDefined();
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
