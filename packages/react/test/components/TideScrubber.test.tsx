import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TideScrubber, type TideScrubberProps } from "../../src/components/TideScrubber.js";
import type { Extreme } from "../../src/types.js";

const H = 3_600_000;
const M = 60_000;
const t0 = Date.UTC(2026, 9, 10);
const NOW = t0 + 25 * H;

/** A 12-hour sine sampled every 10 minutes, with its highs and lows. */
function fixture({ mid = 1, amp = (h: number) => (h >= 0 ? 1 : 1), hours = 96 } = {}) {
  const level = (h: number) => mid + amp(h) * Math.sin((2 * Math.PI * h) / 12);
  const timeline = Array.from({ length: hours * 6 + 1 }, (_, i) => ({
    time: new Date(t0 + i * 10 * M),
    level: level(i / 6),
  }));
  const extremes: Extreme[] = [];
  for (let h = 3; h < hours; h += 6) {
    const high = h % 12 === 3;
    extremes.push({ time: new Date(t0 + h * H), level: level(h), high, low: !high, label: "" });
  }
  return { timeline, extremes };
}

function renderScrubber(props: Partial<TideScrubberProps> = {}, width = 360) {
  const view = render(
    <div style={{ width }}>
      <TideScrubber
        {...fixture()}
        timezone="UTC"
        latitude={50}
        longitude={0}
        units="meters"
        locale="en-US"
        now={NOW}
        {...props}
      />
    </div>,
  );
  return { ...view, slider: screen.getByRole("slider", { name: "Tide timeline" }) };
}

const value = (slider: HTMLElement) => Number(slider.getAttribute("aria-valuenow"));
const text = (slider: HTMLElement) => slider.getAttribute("aria-valuetext") ?? "";
const commentaryPill = () =>
  screen.queryAllByRole("button").find((b) => !/now/i.test(b.ariaLabel!))!;

async function restsOn(slider: HTMLElement, time: number) {
  await waitFor(
    () => {
      expect(value(slider)).toBe(time);
      expect(commentaryPill().tabIndex).toBe(0);
    },
    { timeout: 4000 },
  );
}

const ridingDot = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("div.rounded-full.bg-white")].find(
    (d) => d.style.width === "13px",
  )!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TideScrubber", () => {
  test("opens on now and reads the tide there", async () => {
    const { slider, container } = renderScrubber();

    await restsOn(slider, NOW);
    expect(text(slider)).toMatch(/^Rising 1\.50 metres, Oct 11, 1:00\sAM UTC$/);
    expect(commentaryPill().ariaLabel).toBe("High tide in 2 hours");
    expect(commentaryPill().textContent).toBe("High2h 0m");
    expect(ridingDot(container)).toBeDefined();
    expect(container.querySelector(".sr-only")!.textContent).toBe(text(slider));
  });

  test("reads High at a turn with the turn's height, in the station's units", async () => {
    const { slider } = renderScrubber({ units: "feet" });
    await restsOn(slider, NOW);

    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(value(slider)).toBe(t0 + 27 * H);
    expect(text(slider)).toMatch(/^High 2\.0 feet, Oct 11, 3:00\sAM UTC$/);
    expect(screen.getByText("ft")).toBeDefined();
    expect(commentaryPill().ariaLabel).toBe("Sunrise in 3 hours, 15 minutes");
  });

  test("a fast tide names its rate, and walks to the run's fastest point, then on", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { slider } = renderScrubber(fixture({ mid: 0, amp: () => 2 }));
    await restsOn(slider, NOW);

    expect(commentaryPill().textContent).toBe("Rising 0.91 m/hr");
    expect(commentaryPill().ariaLabel).toBe("Rising 0.91 m/hr");
    expect(commentaryPill().querySelector("span")!.style.color).not.toBe("");
    expect(text(slider)).toMatch(/^Rising /);

    fireEvent.click(commentaryPill());
    expect(value(slider)).toBe(t0 + 24 * H);
    await restsOn(slider, t0 + 24 * H);
    expect(commentaryPill().textContent).toBe("Rising 1.05 m/hr");

    fireEvent.click(commentaryPill());
    expect(value(slider)).toBe(t0 + 27 * H);
  });

  test("the magnet takes a fast run's fastest point", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { slider } = renderScrubber(fixture({ mid: 0, amp: () => 2 }));
    await restsOn(slider, NOW);

    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(value(slider)).toBe(t0 + 24 * H);
  });

  test("fills only amber below datum, and draws the datum line when datum is in view", () => {
    const { container } = renderScrubber(fixture({ mid: 0 }));

    const fill = container.querySelector("[data-fill='below-datum']")!;
    const gradient = container.querySelector(fill.getAttribute("fill")!.slice(4, -1))!;
    expect(gradient.innerHTML).toContain("graph-low");
    expect(gradient.innerHTML).not.toContain("graph-line");
    expect(container.querySelector('line[stroke-dasharray="1 3"]')).not.toBeNull();
  });

  test("water that stays above datum has no amber and no datum line", () => {
    const { container } = renderScrubber(fixture({ mid: 1.2 }));

    expect(container.querySelector("[data-fill='below-datum']")).toBeNull();
    expect(container.querySelector('line[stroke-dasharray="1 3"]')).toBeNull();
  });

  test("marks every turn clear of the edges with its height and time", () => {
    const { container } = renderScrubber();

    const turns = container.querySelectorAll('circle[r="2.5"]');
    expect(turns.length).toBe(16);
    expect(turns[0].getAttribute("fill")).toContain("graph-high");
    expect(turns[1].getAttribute("fill")).toContain("graph-low");
    expect(screen.getAllByText("2.00").length).toBe(8);
    expect(screen.getAllByText("0.00").length).toBe(8);
    expect(screen.getAllByText(/^3:00\sAM$/).length).toBeGreaterThan(0);
  });

  test("colors the curve by rate: blue when slow, the ramp when fast", () => {
    const slow = renderScrubber();
    const stops = (c: HTMLElement) =>
      [...c.querySelectorAll('linearGradient[id$="line"] stop')].map((s) =>
        s.getAttribute("stop-color"),
      );
    expect(new Set(stops(slow.container))).toEqual(new Set(["var(--sw-graph-line, #38bdf8)"]));
    slow.unmount();

    const fast = renderScrubber(fixture({ mid: 0, amp: () => 2 }));
    expect(stops(fast.container)).toContain("#f5c96b");
    expect(stops(fast.container).length).toBe(577);
  });

  test("rescales when the visible water outgrows the fit", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const props = {
      ...fixture({ amp: (h: number) => (h < 72 ? 1 : 3), hours: 144 }),
      now: t0 + 10 * H,
    };
    const { slider, container, rerender } = renderScrubber(props);
    await restsOn(slider, t0 + 10 * H);

    rerender(
      <div style={{ width: 360 }}>
        <TideScrubber
          {...props}
          timezone="UTC"
          latitude={50}
          longitude={0}
          units="meters"
          moveTo={{ time: t0 + 100 * H }}
        />
      </div>,
    );
    expect(value(slider)).toBe(t0 + 100 * H);
    await waitFor(() => {
      const top = parseFloat(ridingDot(container).style.top);
      expect(top).toBeGreaterThan(170);
      expect(top).toBeLessThan(320);
    });
  });

  test("glides to a new scale", async () => {
    const props = {
      ...fixture({ amp: (h: number) => (h < 72 ? 1 : 3), hours: 144 }),
      now: t0 + 10 * H,
    };
    const { slider, container } = renderScrubber(props);
    await restsOn(slider, t0 + 10 * H);

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    for (let i = 0; i < 20; i++) fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    const top = () => parseFloat(ridingDot(container).style.top);
    // The glide's frames run late while other files keep the browser busy.
    await waitFor(
      () => {
        expect(top()).toBeGreaterThan(170);
        expect(top()).toBeLessThan(320);
      },
      { timeout: 4000 },
    );
  });

  test("opens at the edge of data that doesn't reach now", async () => {
    const { slider } = renderScrubber({ now: t0 + 30 * 24 * H });
    await waitFor(() => expect(value(slider)).toBeGreaterThan(t0 + 80 * H), { timeout: 4000 });
    expect(text(slider)).toMatch(/^(Rising|Falling) /);
  });

  test("shows a message when there is too little data to draw", () => {
    render(
      <TideScrubber
        timeline={fixture().timeline.slice(0, 1)}
        extremes={[]}
        timezone="UTC"
        latitude={0}
        longitude={0}
        units="meters"
      />,
    );
    expect(screen.getByText("No tide predictions for this period.")).toBeDefined();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
