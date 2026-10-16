import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CurrentScrubber,
  type CurrentScrubberProps,
} from "../../src/components/CurrentScrubber.js";
import { days } from "../../src/utils/time.js";
import type { CurrentEvent } from "../../src/types.js";

const H = 3_600_000;
const M = 60_000;
const PX_PER_HOUR = 18;
const WIDTH = 360;
const t0 = Date.UTC(2026, 9, 10);
const NOW = t0 + 25 * H;

/**
 * Four days of a 12-hour sine: 3 kn for two days, so slack windows are
 * strokes, then 12 kn, so they narrow to dots. The last max ebb has no set.
 */
function fixture(start: number) {
  const timeline = Array.from({ length: 577 }, (_, i) => ({
    time: new Date(start + i * 10 * M),
    speed: (i < 288 ? 3 : 12) * Math.sin((2 * Math.PI * i) / 72),
  }));
  const events: CurrentEvent[] = [];
  for (let h = 3; h < 96; h += 3) {
    const time = new Date(start + h * H);
    const amp = h < 48 ? 3 : 12;
    if (h % 12 === 3) events.push({ time, speed: amp, kind: "maxFlood", direction: 45 });
    else if (h % 12 === 9)
      events.push({ time, speed: -amp, kind: "maxEbb", ...(h < 90 && { direction: 225 }) });
    else events.push({ time, speed: 0, kind: "slack" });
  }
  return { timeline, events };
}

function scrubber(props: Partial<CurrentScrubberProps> = {}, width = WIDTH) {
  return (
    <div data-testid="frame" style={{ width }}>
      <CurrentScrubber
        {...fixture(t0)}
        timezone="UTC"
        latitude={50}
        longitude={0}
        directions={{ flood: 45 }}
        locale="en-US"
        now={NOW}
        className="extra"
        {...props}
      />
    </div>
  );
}

function renderScrubber(props: Partial<CurrentScrubberProps> = {}, width = WIDTH) {
  const view = render(scrubber(props, width));
  return { ...view, slider: screen.getByRole("slider", { name: "Current timeline" }) };
}

const value = (slider: HTMLElement) => Number(slider.getAttribute("aria-valuenow"));
const text = (slider: HTMLElement) => slider.getAttribute("aria-valuetext") ?? "";
/** The pill naming the next stop. */
const commentaryPill = () =>
  screen.queryAllByRole("button").find((b) => !/now/i.test(b.ariaLabel!))!;
const nowPill = () => screen.queryByRole("button", { name: "Return to now" });

/** Waits for the strip to come to rest on `time`, when the pills become reachable. */
async function restsOn(slider: HTMLElement, time: number) {
  await waitFor(
    () => {
      expect(value(slider)).toBe(time);
      expect(commentaryPill().tabIndex).toBe(0);
    },
    { timeout: 4000 },
  );
}

/** Scrolls so `time` is under the center line, as a person would. */
function scrollTo(slider: HTMLElement, time: number) {
  fireEvent.wheel(slider, { deltaX: 40 });
  slider.scrollLeft = ((time - t0) / H) * PX_PER_HOUR - slider.clientWidth / 2;
}

/** A tap at `time` on the strip, `y` px below its top. */
function tap(slider: HTMLElement, time: number, y = 100) {
  const rect = slider.getBoundingClientRect();
  const clientX = rect.left + ((time - t0) / H) * PX_PER_HOUR - slider.scrollLeft;
  const init = { clientX, clientY: rect.top + y, pointerType: "touch", pointerId: 1 };
  fireEvent.pointerDown(slider, init);
  fireEvent.pointerMove(slider, init);
  fireEvent.pointerUp(slider, init);
}

const key = (slider: HTMLElement, key: string, shiftKey = false) =>
  fireEvent.keyDown(slider, { key, shiftKey });

/** Four hours of a steady 0.2 kn. */
const tinyTimeline = Array.from({ length: 25 }, (_, i) => ({
  time: new Date(t0 + i * 10 * M),
  speed: 0.2,
}));

function renderEmpty(timeline: CurrentScrubberProps["timeline"]) {
  return render(
    <CurrentScrubber timeline={timeline} events={[]} timezone="UTC" latitude={0} longitude={0} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CurrentScrubber", () => {
  test("frames later than the rest delay don't cut the opening short", async () => {
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
      setTimeout(() => frame(performance.now()), 600),
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    // The opening starts on the slack at 24 h, inside the magnet's reach.
    const { slider } = renderScrubber({ now: t0 + 26 * H });

    await restsOn(slider, t0 + 26 * H);
  });

  test("glides open onto now and reads the current there", async () => {
    const { slider } = renderScrubber();

    expect(value(slider)).toBeLessThan(NOW);
    await restsOn(slider, NOW);
    expect(text(slider)).toBe("Flooding, 1.5 knots, setting NE, Oct 11, 1:00 AM UTC");
    expect(commentaryPill().ariaLabel).toBe("Maximum flood current in 2 hours");
    expect(commentaryPill().textContent).toBe("Max flood2h 0m");
    expect(nowPill()).toBeNull();
  });

  test("opens directly on now under Reduce Motion, and moves directly", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { slider } = renderScrubber();

    expect(value(slider)).toBe(NOW);
    await restsOn(slider, NOW);
    fireEvent.click(commentaryPill());
    expect(value(slider)).toBe(t0 + 27 * H);
    expect(document.activeElement).toBe(slider);
  });

  test("treats a browser without matchMedia as allowing motion", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { slider } = renderScrubber();

    expect(value(slider)).toBeLessThan(NOW);
    await restsOn(slider, NOW);
  });

  test("steps five minutes with the arrow keys and between stops with Shift", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);

    key(slider, "ArrowRight");
    expect(value(slider)).toBe(NOW + 5 * M);
    key(slider, "ArrowLeft");
    expect(value(slider)).toBe(NOW);
    key(slider, "Enter");
    expect(value(slider)).toBe(NOW);

    key(slider, "ArrowRight", true);
    expect(value(slider)).toBe(t0 + 27 * H);
    expect(text(slider)).toMatch(/^Max flood, 3\.0 knots, setting NE/);
    expect(nowPill()!.textContent).toBe("Now");

    key(slider, "ArrowLeft", true);
    key(slider, "ArrowLeft", true);
    expect(value(slider)).toBe(t0 + 24 * H);
    expect(text(slider)).toMatch(/^Slack, 0\.0 knots, Oct 11/);

    fireEvent.click(nowPill()!);
    expect(document.activeElement).toBe(slider);
    await restsOn(slider, NOW);
    expect(nowPill()).toBeNull();
  });

  test("Shift+Right walks every kind of stop it can reach", () => {
    const { slider } = renderScrubber({ now: t0 });
    const spoken = new Set<string>();
    let last: number;
    do {
      last = value(slider);
      spoken.add(commentaryPill().ariaLabel!.replace(/ in .*/, ""));
      key(slider, "ArrowRight", true);
    } while (value(slider) !== last && commentaryPill());

    expect([...spoken].sort()).toEqual([
      "Ebb current",
      "Flood current",
      "Maximum ebb current",
      "Maximum flood current",
      "Slack current",
      "Sunrise",
      "Sunset",
    ]);
  });

  test("names and steps to only the stops the center line can reach", async () => {
    // At 375 px the center reaches 10 h 25 m short of the end, at 85 h 35 m.
    const { slider, getByTestId } = renderScrubber({ now: t0 + 85 * H }, 375);
    await waitFor(() => expect(value(slider)).toBe(t0 + 85 * H), { timeout: 4000 });
    expect(commentaryPill()).toBeUndefined();
    key(slider, "ArrowRight", true);
    expect(value(slider)).toBe(t0 + 85 * H);

    // Narrower, the max flood at 87 h comes into reach.
    getByTestId("frame").style.width = "300px";
    await waitFor(() =>
      expect(commentaryPill()?.ariaLabel).toBe("Maximum flood current in 2 hours"),
    );
  });

  test("a Now pill appears only where it can move the strip", async () => {
    // At 1500 px the earliest centerable time is 41 h 40 m, after now.
    const home = t0 + (1500 / 2 / PX_PER_HOUR) * H;
    const { slider } = renderScrubber({}, 1500);
    await restsOn(slider, home);
    expect(nowPill()).toBeNull();

    key(slider, "ArrowRight", true);
    key(slider, "ArrowRight", true);
    expect(value(slider)).toBe(t0 + 42 * H);
    fireEvent.click(nowPill()!);
    await restsOn(slider, home);
    expect(nowPill()).toBeNull();
  });

  test("Reduce Motion opens on the exact instant of now", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { slider } = renderScrubber({ now: NOW + 77_000 });

    await restsOn(slider, NOW + 77_000);
  });

  test("keeps the selection when new data spans a different range", async () => {
    const { slider, rerender } = renderScrubber();
    await restsOn(slider, NOW);

    rerender(scrubber(fixture(t0 + 12 * H)));
    expect(value(slider)).toBe(NOW);
    expect(slider.scrollLeft).toBe(13 * PX_PER_HOUR - WIDTH / 2);

    // Clamped into data that starts after it.
    rerender(scrubber(fixture(t0 + 30 * H)));
    expect(value(slider)).toBe(t0 + 30 * H + (WIDTH / 2 / PX_PER_HOUR) * H);
  });

  test.each([[[]], [[{ time: new Date(t0), speed: 1 }]]])(
    "shows a message for fewer than two samples",
    (timeline) => {
      renderEmpty(timeline);
      expect(screen.queryByRole("slider")).toBeNull();
      expect(screen.getByText("No current predictions for this period.")).toBeDefined();
    },
  );

  test("a tap on the plot centers the nearest stop, or the tapped time", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);

    tap(slider, t0 + 27 * H + 10 * M);
    await restsOn(slider, t0 + 27 * H);

    tap(slider, t0 + 26 * H);
    await restsOn(slider, t0 + 26 * H);

    // A lone move or release, and a canceled press, do nothing.
    fireEvent.pointerMove(slider, { pointerType: "mouse" });
    fireEvent.pointerUp(slider);
    fireEvent.pointerDown(slider, { pointerType: "touch" });
    fireEvent.pointerCancel(slider);
    fireEvent.pointerUp(slider);
    expect(value(slider)).toBe(t0 + 26 * H);
  });

  test("a tap on the day row centers a sun event but not a date", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);
    const sunrise = days(t0 + 24 * H, t0 + 25 * H, "UTC", 50, 0)[0].sunrise!;

    tap(slider, sunrise + 5 * M, 378);
    await restsOn(slider, sunrise);

    tap(slider, t0 + 36 * H, 364);
    await new Promise((r) => setTimeout(r, 600));
    expect(value(slider)).toBe(sunrise);
  });

  test("a scroll comes to rest on a stop within the magnet's reach", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);

    scrollTo(slider, t0 + 27 * H + 10 * M);
    await restsOn(slider, t0 + 27 * H);

    // Out of reach of any stop, it rests where it was left.
    fireEvent.touchMove(slider);
    scrollTo(slider, t0 + 26 * H);
    await restsOn(slider, t0 + 26 * H);

    // Already on a stop, it rests there.
    scrollTo(slider, t0 + 27 * H);
    await restsOn(slider, t0 + 27 * H);
  });

  test("a horizontal wheel stops the opening glide, and a vertical one doesn't", async () => {
    const first = renderScrubber();
    fireEvent.wheel(first.slider, { deltaX: 2, deltaY: 30 });
    await restsOn(first.slider, NOW);
    first.unmount();

    const { slider } = renderScrubber();
    fireEvent.wheel(slider, { deltaX: 30, deltaY: 2 });
    await waitFor(() => expect(commentaryPill().tabIndex).toBe(0), { timeout: 4000 });
    expect(value(slider)).toBeLessThan(NOW - H);
  });

  test("draws a slack dot at the edge of the data", () => {
    const { events } = fixture(t0);
    const { container } = renderScrubber({
      events: [...events, { time: new Date(t0 + 96 * H), speed: 0, kind: "slack" }],
    });
    const dots = [...container.querySelectorAll('circle[r="2.5"]')].map((c) =>
      Number(c.getAttribute("cx")),
    );
    expect(Math.max(...dots)).toBeGreaterThan((96 - 1.5) * PX_PER_HOUR);
  });

  test("a scroll no person made rests where it lands, without the magnet", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);

    slider.scrollLeft = ((27 * H + 10 * M) / H) * PX_PER_HOUR - WIDTH / 2;
    await restsOn(slider, t0 + 27 * H + 10 * M);
  });

  test("a glide cut short rests like a scroll", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);

    fireEvent.click(commentaryPill());
    slider.scrollLeft = ((30 * H + 5 * M) / H) * PX_PER_HOUR - WIDTH / 2;
    await restsOn(slider, t0 + 30 * H);
  });

  test("a mouse drag pans the strip once it moves past a jitter", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);
    const mouse = (x: number) => ({ clientX: x, clientY: 100, pointerType: "mouse", pointerId: 1 });

    fireEvent.pointerDown(slider, mouse(300));
    fireEvent.pointerMove(slider, mouse(303));
    expect(value(slider)).toBe(NOW);
    fireEvent.pointerMove(slider, mouse(120));
    fireEvent.pointerMove(slider, mouse(100));
    fireEvent.pointerUp(slider, mouse(100));
    // 200 px is 11 h 7 m, which rests on the slack at 36 h.
    await restsOn(slider, t0 + 36 * H);
  });

  test("rests after a move even when the browser doesn't scroll", async () => {
    const { slider } = renderScrubber();
    await restsOn(slider, NOW);
    slider.scrollTo = () => {};

    key(slider, "ArrowRight");
    expect(commentaryPill().tabIndex).toBe(-1);
    await restsOn(slider, NOW + 5 * M);
  });

  test("keeps the selected time centered when the width changes", async () => {
    const { slider, getByTestId } = renderScrubber();
    // A resize during the opening leaves the opening to finish the move.
    getByTestId("frame").style.width = `${WIDTH + 40}px`;
    await restsOn(slider, NOW);

    getByTestId("frame").style.width = `${WIDTH + 120}px`;
    await waitFor(() => expect(slider.scrollLeft).toBe(25 * PX_PER_HOUR - (WIDTH + 120) / 2));
    await restsOn(slider, NOW);
  });

  test("follows the clock back to now on returning to the page", async () => {
    const start = Math.floor(Date.now() / H) * H - 48 * H;
    const { slider } = renderScrubber({ ...fixture(start), now: undefined });
    await waitFor(() => expect(commentaryPill().tabIndex).toBe(0), { timeout: 4000 });
    const opened = value(slider);
    expect(Math.abs(opened - Date.now())).toBeLessThan(10_000);

    const realNow = Date.now.bind(Date);
    let skew = H;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(value(slider)).toBe(opened);

    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(value(slider) - opened).toBeGreaterThanOrEqual(H), {
      timeout: 4000,
    });

    // Away from now, a return to the page leaves the selection where it is.
    key(slider, "ArrowLeft", true);
    const away = value(slider);
    skew = 2 * H;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(value(slider)).toBe(away);

    fireEvent.click(nowPill()!);
    await waitFor(() => expect(value(slider) - opened).toBeGreaterThanOrEqual(2 * H), {
      timeout: 4000,
    });
  });

  test("a strip wider than its data has no reading and no Now pill", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <CurrentScrubber
        timeline={tinyTimeline}
        events={[]}
        timezone="UTC"
        latitude={85}
        longitude={0}
        now={t0 + 6 * H}
      />,
    );
    const slider = screen.getByRole("slider");
    const opened = value(slider);

    expect(slider.hasAttribute("aria-valuetext")).toBe(false);
    expect(screen.queryAllByRole("button")).toEqual([]);
    key(slider, "ArrowRight", true);
    expect(value(slider)).toBe(opened);
  });

  test.each([
    ["full motion", false],
    ["Reduce Motion", true],
  ])("comes to rest when the opening has nowhere to move, under %s", async (_, reduce) => {
    vi.stubGlobal("matchMedia", () => ({ matches: reduce }));
    render(
      <div style={{ width: 36 }}>
        <CurrentScrubber
          timeline={tinyTimeline}
          events={[{ time: new Date(t0 + 3 * H), speed: 0.2, kind: "maxFlood" }]}
          timezone="UTC"
          latitude={50}
          longitude={0}
          now={t0 - 6 * H}
        />
      </div>,
    );

    await waitFor(() => expect(commentaryPill().tabIndex).toBe(0));
    expect(value(screen.getByRole("slider"))).toBe(t0 + H);
  });
});
