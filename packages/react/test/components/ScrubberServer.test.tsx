import { Activity, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, inject, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  fetchCurrentStationEvents,
  fetchCurrentStationTimeline,
  fetchStationExtremes,
  fetchStationTimeline,
} from "../../src/client.js";
import { CurrentScrubber } from "../../src/components/CurrentScrubber.js";
import { TideScrubber } from "../../src/components/TideScrubber.js";
import { stationWindow } from "../../src/utils/schedule.js";
import { startOfDay } from "../../src/utils/time.js";
import { H, LATER, NOW, current, nodeRendered, t0, tide, tides } from "../scrubber-fixtures.js";

const M = 60_000;

/** The reading a screen reader hears, which the lead prints beside it. */
const lead = (html: string) => /<span class="sr-only">([^<]*)<\/span>/.exec(html)?.[1];
const bytes = (html: string) => new TextEncoder().encode(html).length;

/** The server render at a build clock three days before the reader's. */
function built(element: ReactElement) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(NOW - 72 * H);
  const html = renderToString(element);
  clock.mockReturnValue(NOW);
  return html;
}

const roots: Root[] = [];
/** Serves `html` into a 360 px frame and hydrates `element` over it, collecting every mismatch React reports. */
async function hydrate(element: ReactElement, html = built(element)) {
  const frame = document.createElement("div");
  frame.style.width = "360px";
  frame.innerHTML = html;
  document.body.append(frame);
  const errors: unknown[] = [];
  const logged = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
  await act(async () => {
    roots.push(hydrateRoot(frame, element, { onRecoverableError: (e) => errors.push(e) }));
  });
  logged.mockRestore();
  return { frame, errors, slider: frame.querySelector<HTMLElement>('[role="slider"]')! };
}

afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a selected moment", () => {
  test("renders that moment's reading on the server", () => {
    const opening = renderToString(tide({ selected: NOW }));
    const later = renderToString(tide({ selected: LATER }));

    expect(lead(opening)).toMatch(/^Rising 1\.50 metres, Oct 11, 1:00\sAM UTC$/);
    expect(lead(later)).toMatch(/^Rising 1\.50 metres, Oct 12, 1:00\sPM UTC$/);
    expect(opening).toContain(`aria-valuenow="${NOW}"`);
    expect(later).not.toBe(opening);
    // The moment rests, so its pills show before any script runs.
    const pill = /<button[^>]*aria-label="High tide in 2 hours"[^>]*>/.exec(opening)![0];
    expect(pill).toContain("opacity:1");
    expect(pill).toContain('tabindex="0"');
  });

  test("the moment a move asks for is not the server's", () => {
    expect(renderToString(tide({ moveTo: { time: LATER } }))).toBe(renderToString(tide()));
  });

  test("hydrates without a mismatch and opens in place, reported once", async () => {
    const selected: number[] = [];
    const element = tide({ selected: LATER, onSelect: (t) => selected.push(t) });
    const { errors, slider, frame } = await hydrate(element);

    expect(errors).toEqual([]);
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(LATER);
    expect(slider.scrollLeft).toBeCloseTo(61 * 18 - 180, 0);
    expect(selected).toEqual([LATER]);
    // Away from now, so the Now pill joins it, both already at rest.
    expect(frame.querySelector('[aria-label="Return to now"]')).not.toBeNull();
    // The scroll that placed it is no move: the pills stay up.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame.querySelector<HTMLElement>('[aria-label="Return to now"]')!.tabIndex).toBe(0);
    expect(selected).toEqual([LATER]);
  });

  test("a later selected moment is ignored; moveTo moves", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const view = render(<div style={{ width: 360 }}>{tide({ selected: NOW, now: NOW })}</div>);
    const slider = screen.getByRole("slider");
    view.rerender(<div style={{ width: 360 }}>{tide({ selected: LATER, now: NOW })}</div>);
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(NOW);
    view.rerender(
      <div style={{ width: 360 }}>
        {tide({ selected: LATER, now: NOW, moveTo: { time: LATER } })}
      </div>,
    );
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(LATER);
  });

  test("a move asked for on mount lands once the whole strip is drawn", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<div style={{ width: 360 }}>{tide({ now: NOW, moveTo: { time: LATER } })}</div>);
    expect(Number(screen.getByRole("slider").getAttribute("aria-valuenow"))).toBe(LATER);
  });

  test("sits under the center line before any script runs, however wide the strip", () => {
    for (const width of [360, 900]) {
      const frame = document.createElement("div");
      frame.style.width = `${width}px`;
      frame.innerHTML = renderToString(tide({ selected: LATER }));
      document.body.append(frame);
      const svg = frame.querySelector("svg[viewBox]")!;
      const viewX = Number(svg.getAttribute("viewBox")!.split(" ")[0]);
      const momentX = svg.getBoundingClientRect().left + 61 * 18 - viewX;
      const box = frame.getBoundingClientRect();
      expect(momentX).toBeCloseTo(box.left + width / 2, 0);
      frame.remove();
    }
  });

  test("a bounded day short enough to draw whole keeps its edge labels and centers its moment", () => {
    const day = tides(24);
    const html = renderToString(tide({ ...day, bounded: true, selected: t0 + 6 * H }));
    const frame = document.createElement("div");
    frame.style.width = "736px";
    frame.innerHTML = html;
    document.body.append(frame);
    const svg = frame.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBeNull();
    expect(svg.style.overflow).toBe("visible");
    expect(svg.getBoundingClientRect().left + 6 * 18).toBeCloseTo(
      frame.getBoundingClientRect().left + 368,
      0,
    );
  });

  test("a selected moment at the strip's very start still lets the first scroll move it", async () => {
    const { slider } = await hydrate(tide({ ...tides(24), bounded: true, now: NOW, selected: t0 }));
    expect(slider.scrollLeft).toBe(0);
    slider.scrollLeft = 90;
    await waitFor(() => expect(Number(slider.getAttribute("aria-valuenow"))).toBe(t0 + 5 * H));
  });

  test("a bounded day's partial stretch keeps room for the labels at its own end", () => {
    const day = tides(24);
    day.extremes.unshift({
      time: new Date(t0 + 0.5 * H),
      level: 1.5,
      high: false,
      low: true,
      label: "",
    });
    const html = renderToString(tide({ ...day, bounded: true, selected: t0 + 2 * H }));
    const frame = document.createElement("div");
    frame.style.width = "736px";
    frame.innerHTML = html;
    document.body.append(frame);
    const svg = frame.querySelector("svg")!;
    const [left, , width] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    // Its start overhangs by half the widest label; the cut end, toward the day's end, doesn't.
    expect(left).toBe(-27);
    expect(width).toBe(27 + 22 * 18);
    // Its clock, centered 9 px in, spills past the start.
    expect(frame.querySelector('text[x="9"]')!.textContent).toMatch(/^12:30\sAM$/);
    expect(svg.getBoundingClientRect().left + 27 + 2 * 18).toBeCloseTo(
      frame.getBoundingClientRect().left + 368,
      0,
    );
  });

  test("renders a current's reading on the server and hydrates it", async () => {
    const element = current(NOW);
    const html = built(element);
    expect(lead(html)).toMatch(/^1\.5 knots, set northeast, Oct 11, 1:00\sAM UTC$/);
    expect(html).not.toContain("Return to now");
    const { errors, slider } = await hydrate(element, html);
    expect(errors).toEqual([]);
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(NOW);
  });

  test("a stretch draws what the whole strip draws there", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    // Every mark and label with its place, inside the stretch's own span; marks hung from a turn are placed by their group.
    const place = (e: Element) =>
      e.getAttribute("x") ??
      e.getAttribute("cx") ??
      /translate\(([-\d.]+)/.exec(e.getAttribute("transform") ?? "")?.[1];
    const marks = (root: ParentNode, from: number, to: number) =>
      [...root.querySelectorAll("svg text, svg circle, svg g[transform]")]
        .filter((e) => Number(place(e)) >= from && Number(place(e)) <= to)
        .map((e) => `${e.tagName}@${place(e)}:${e.textContent}`)
        .sort();
    for (const element of [tide({ selected: LATER }), current(LATER)]) {
      const frame = document.createElement("div");
      frame.innerHTML = renderToString(element);
      const [left, , width] = frame
        .querySelector("svg")!
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      const whole = render(element);
      const drawn = marks(frame, left, left + width);
      expect(drawn.length).toBeGreaterThan(10);
      expect(drawn).toEqual(marks(whole.container, left, left + width));
      whole.unmount();
    }
  });

  test("Node's server render hydrates in the browser without a mismatch", async () => {
    const html = inject("nodeHtml");
    for (const [name, element] of Object.entries(nodeRendered)) {
      expect(html[name as keyof typeof html], name).toBe(renderToString(element()));
      const { errors } = await hydrate(element(), html[name as keyof typeof html]);
      expect(errors, name).toEqual([]);
    }
  });
});

describe("without now", () => {
  const NOW_DOT = 'fill="var(--sw-paper, #fcfcfc)"';

  test("the server claims no now: no now dot, relative days, past, or Now pill", () => {
    const html = renderToString(tide({ selected: NOW + 6 * H }));
    expect(html).not.toContain(NOW_DOT);
    expect(html).not.toMatch(/>(Today|Tomorrow|Yesterday)</);
    expect(html).toMatch(/>Sun</);
    expect(html).not.toContain('opacity="0.45"');
    expect(html).not.toContain("Return to now");

    // With a now, the same strip claims all of it.
    const claimed = renderToString(tide({ selected: NOW + 6 * H, now: NOW }));
    expect(claimed).toContain(NOW_DOT);
    expect(claimed).toContain('opacity="0.45"');
    expect(claimed).toMatch(/>Today</);
    expect(claimed).toContain("Return to now");
  });

  test("with no moment either, the server draws the data's middle and reads nothing", () => {
    const html = renderToString(tide());
    expect(lead(html)).toBeUndefined();
    expect(html).toContain(`aria-valuenow="${t0 + 48 * H}"`);
    // A screen reader hears the moment's date and time, not a reading.
    expect(html).toMatch(/aria-valuetext="Oct 12, 12:00\sAM UTC"/);
    expect(html).not.toContain("tide in");
    expect(html).not.toContain(NOW_DOT);
  });

  test("hydrates without a mismatch, then opens on the clock", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const selected: number[] = [];
    const { errors, slider, frame } = await hydrate(tide({ onSelect: (t) => selected.push(t) }));

    expect(errors).toEqual([]);
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(NOW);
    expect(selected).toEqual([NOW]);
    expect(frame.innerHTML).toContain(NOW_DOT);
    expect(frame.innerHTML).toMatch(/>Today</);
  });
});

describe("server size", () => {
  const ANCHOR = startOfDay(Date.UTC(2026, 10, 16, 20), "America/Los_Angeles");

  test("Seattle's week draws its first view on the server, and all of it once mounted", async () => {
    const base = inject("apiBaseUrl");
    const params = { id: "noaa/9447130", ...stationWindow(ANCHOR) };
    const [t, e] = await Promise.all([
      fetchStationTimeline(base, params),
      fetchStationExtremes(base, params),
    ]);
    const element = (
      <TideScrubber
        timeline={t.timeline}
        extremes={e.extremes}
        timezone="America/Los_Angeles"
        latitude={47.6}
        longitude={-122.34}
        units={t.units}
        locale="en-US"
        selected={ANCHOR + 15 * H}
      />
    );
    const server = bytes(renderToString(element));
    expect(server).toBeLessThan(55_000);
    const { frame, errors } = await hydrate(element);
    expect(errors).toEqual([]);
    expect(bytes(frame.innerHTML)).toBeGreaterThan(280_000);
  });

  test("a current station's week does too", async () => {
    const base = inject("apiBaseUrl");
    const params = { id: "noaa/PUG1701", ...stationWindow(ANCHOR) };
    const [t, e] = await Promise.all([
      fetchCurrentStationTimeline(base, params),
      fetchCurrentStationEvents(base, params),
    ]);
    const element = (
      <CurrentScrubber
        timeline={t.timeline}
        events={e.events}
        timezone="America/Los_Angeles"
        latitude={47.6}
        longitude={-122.34}
        setFormat="compass"
        locale="en-US"
        selected={ANCHOR + 15 * H}
      />
    );
    const server = bytes(renderToString(element));
    expect(server).toBeLessThan(60_000);
    const { frame, errors } = await hydrate(element);
    expect(errors).toEqual([]);
    expect(bytes(frame.innerHTML)).toBeGreaterThan(5 * server);
  });
});

describe("unusable moments", () => {
  test("a moment that isn't a number renders like none", () => {
    expect(renderToString(tide({ selected: NaN }))).toBe(renderToString(tide()));
  });

  test("a moment past the data opens on its end, on the server and in the browser", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const end = t0 + 96 * H;
    const html = renderToString(tide({ selected: end + 30 * 24 * H }));
    expect(html).toContain(`aria-valuenow="${end}"`);
    expect(lead(html)).toMatch(/, Oct 14, 12:00\sAM UTC$/);
    const { slider, errors } = await hydrate(tide({ selected: end + 30 * 24 * H }));
    expect(errors).toEqual([]);
    // The browser centers the last moment a 360 px strip can.
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(end - 10 * H);
  });
});

describe("an Activity shown again", () => {
  test("keeps its clock: a strip resting at now stays home", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <div style={{ width: 360 }}>{tide()}</div>
      </Activity>
    );
    const { rerender } = render(view("visible"));
    const slider = screen.getByRole("slider");
    await waitFor(() => expect(Number(slider.getAttribute("aria-valuenow"))).toBe(NOW));

    vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * H);
    rerender(view("hidden"));
    rerender(view("visible"));
    expect(screen.queryByRole("button", { name: "Return to now" })).toBeNull();
  });

  test("keeps the tide scale it governed rather than refitting around now", async () => {
    vi.spyOn(Date, "now").mockReturnValue(t0 + 10 * H);
    // Swings triple after 72 hours, so the water there needs a wider scale than now's.
    const level = (h: number) => 1 + (h < 72 ? 1 : 3) * Math.sin((2 * Math.PI * h) / 12);
    const timeline = Array.from({ length: 144 * 6 + 1 }, (_, i) => ({
      time: new Date(t0 + i * 10 * M),
      level: level(i / 6),
    }));
    const view = (mode: "visible" | "hidden", moveTo?: { time: number }) => (
      <Activity mode={mode}>
        <div style={{ width: 360 }}>{tide({ timeline, extremes: [], moveTo })}</div>
      </Activity>
    );
    const far = { time: t0 + 100 * H };
    const { rerender, container } = render(view("visible"));
    rerender(view("visible", far));
    const curve = () => container.querySelector("svg path[stroke-width='2.5']")!.getAttribute("d");
    await waitFor(() => expect(Number(screen.getByRole("slider").ariaValueNow)).toBe(far.time), {
      timeout: 10000,
    });
    // The governor glides to the wider scale; wait until the curve holds still.
    let governed: string | null = null;
    await waitFor(
      () => {
        const drawn = curve();
        const still = drawn === governed;
        governed = drawn;
        expect(still).toBe(true);
      },
      { timeout: 10000, interval: 400 },
    );

    rerender(view("hidden", far));
    rerender(view("visible", far));
    expect(curve()).toBe(governed);
  });
});
