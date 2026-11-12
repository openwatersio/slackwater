import { G } from "../../src/components/Scrubber.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TideScrubber, type TideScrubberProps } from "../../src/components/TideScrubber.js";
import type { Extreme } from "../../src/types.js";

const H = 3_600_000;
const M = 60_000;
const t0 = Date.UTC(2026, 9, 10);
const NOW = t0 + 25 * H;

/** A 12-hour sine sampled every 10 minutes, with its highs and lows. */
function fixture({ mid = 1, amp = (_h: number): number => 1, hours = 96 } = {}) {
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

  test("reports now while it opens, never the hours it glides in from", async () => {
    const selected: number[] = [];
    const { slider } = renderScrubber({ onSelect: (time) => selected.push(time) });

    await restsOn(slider, NOW);
    expect(selected.length).toBeGreaterThan(0);
    expect(new Set(selected)).toEqual(new Set([NOW]));
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

  test("a fast tide walks forward through its peak without returning to a passed peak", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { slider } = renderScrubber({ ...fixture({ mid: 0, amp: () => 2 }), now: t0 + 23 * H });
    await restsOn(slider, t0 + 23 * H);

    expect(commentaryPill().textContent).toBe("Fastest rise1h 0m");
    expect(screen.getByText("Rising 0.91 m/hr")).toBeDefined();
    expect(commentaryPill().ariaLabel).toBe("Fastest rising tide in 1 hour");
    expect(commentaryPill().querySelector("span")!.style.color).not.toBe("");
    expect(text(slider)).toContain("metres per hour");

    fireEvent.click(commentaryPill());
    expect(value(slider)).toBe(t0 + 24 * H);
    await restsOn(slider, t0 + 24 * H);
    expect(commentaryPill().textContent).toBe("High3h 0m");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await restsOn(slider, t0 + 24 * H + 5 * 60_000);
    expect(commentaryPill().ariaLabel).toBe("High tide in 2 hours, 55 minutes");

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

  test("heights without a chart datum have no amber and no datum line", () => {
    const { container } = renderScrubber({ ...fixture({ mid: 0 }), chartDatum: false });

    expect(container.querySelector("[data-fill='below-datum']")).toBeNull();
    expect(container.querySelector('line[stroke-dasharray="1 3"]')).toBeNull();
  });

  test("water that stays above datum has no amber and no datum line", () => {
    const { container } = renderScrubber(fixture({ mid: 1.2 }));

    expect(container.querySelector("[data-fill='below-datum']")).toBeNull();
    expect(container.querySelector('line[stroke-dasharray="1 3"]')).toBeNull();
  });

  test("high and low axis times reuse their event colors", () => {
    const { container } = renderScrubber();
    const times = [...container.querySelectorAll(`text[y="${G.eventTimeY}"]`)];
    const high = times.find((t) => /^3:00\sAM$/.test(t.textContent!))!;
    const low = times.find((t) => /^9:00\sAM$/.test(t.textContent!))!;
    expect(high.getAttribute("fill")).toContain("sw-graph-high");
    expect(low.getAttribute("fill")).toContain("sw-graph-low");
    expect(high.getAttribute("font-size")).toBe("14");
    expect(low.getAttribute("font-size")).toBe("14");
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

  test("reports only the edge it opens on when the data doesn't reach now", async () => {
    const selected: number[] = [];
    const { slider } = renderScrubber({
      now: t0 + 30 * 24 * H,
      onSelect: (time) => selected.push(time),
    });
    await waitFor(() => expect(value(slider)).toBeGreaterThan(t0 + 80 * H), { timeout: 4000 });
    await waitFor(() => expect(selected.at(-1)).toBe(value(slider)), { timeout: 4000 });

    expect(new Set(selected)).toEqual(new Set([value(slider)]));
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

test("centers and clamps a bounded tide day wider than its real curve", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const data = fixture({ hours: 24 });
  const now = t0 + 22 * H;
  const { slider } = renderScrubber({ ...data, now, bounded: true }, 736);
  await waitFor(() => expect(value(slider)).toBe(now));
  expect(slider.scrollLeft).toBeCloseTo(22 * 18, 1);
  fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
  expect(value(slider)).toBe(t0 + 21 * H);
  fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
  expect(value(slider)).toBe(t0 + 21 * H);
  slider.scrollLeft = 0;
  await waitFor(() => expect(value(slider)).toBe(t0));
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(value(slider)).toBe(t0);
  slider.scrollLeft = slider.scrollWidth;
  await waitFor(() => expect(value(slider)).toBe(t0 + 24 * H));
  expect(text(slider)).not.toBe("");
});

test("a bounded falling segment without a following low reads and announces Falling", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const timeline = [1, 0.8, 0.6].map((level, i) => ({ time: new Date(t0 + (i + 2) * H), level }));
  const { slider } = renderScrubber(
    { timeline, extremes: [], now: t0 + 3 * H, bounded: true },
    736,
  );
  expect(value(slider)).toBe(t0 + 3 * H);
  expect(text(slider)).toMatch(/^Falling 0.80 metres/);
  expect(screen.getByText("Falling")).toBeDefined();
});

test("bounded tide windows retain high and low labels near both real endpoints", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const timeline = Array.from({ length: 21 }, (_, i) => ({
    time: new Date(t0 + (i * H) / 4),
    level: 2 + Math.cos(((i / 4 - 0.25) * Math.PI) / 4.5),
  }));
  const extremes: Extreme[] = [
    { time: new Date(t0 + H / 4), level: 3, high: true, low: false, label: "High" },
    { time: new Date(t0 + 4.75 * H), level: 1, high: false, low: true, label: "Low" },
  ];
  const { container } = renderScrubber(
    { timeline, extremes, now: t0 + 2.5 * H, bounded: true },
    736,
  );
  expect([...container.querySelectorAll('text[font-size="18"]')].map((t) => t.textContent)).toEqual(
    ["3.00", "1.00"],
  );
  expect(container.querySelectorAll(`text[y="${G.eventTimeY}"]`)).toHaveLength(2);
});
