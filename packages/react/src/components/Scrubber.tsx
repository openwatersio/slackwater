import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  NEAR_NOW_MS,
  PX_PER_HOUR,
  UNIT_MS,
  adjacentTarget,
  commentary,
  dayRowHit,
  magnetTarget,
  reachable,
  rides,
  scrubberStops,
  type Stop,
  type StopKind,
} from "../utils/scrubber.js";
import {
  chartTime,
  dayAnchor,
  dayLabel,
  days,
  shortDate,
  sunBands,
  type Band,
  type Day,
} from "../utils/time.js";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const HOUR = 3_600_000;
/** The strip's fixed rows, shared by every track. */
export const G = {
  topPad: 160,
  pillTop: 124,
  plotTop: 170,
  plotBottom: 320,
  eventTimeY: 338,
  dayY: 364,
  sunDotY: 378,
  dateY: 381,
  height: 396,
};
/** Taps below this line belong to the day, date, and sun row. */
const DAY_ROW_Y = (G.eventTimeY + G.dayY) / 2;
const PILL_HEIGHT = 30;
const REST_MS = 450;
const OPEN_FROM_MS = 2 * HOUR;
const OPEN_DURATION_MS = 650;
const FADE_MS = 0.75 * HOUR;
/** Clear space around dots and the now dot. */
export const HALO_GAP = 2.5;

export const C = {
  line: "var(--sw-graph-line, #38bdf8)",
  go: "var(--sw-go, #88b868)",
  foam: "var(--sw-foam, #e4f0e4)",
  canvas: "var(--sw-canvas, #05122a)",
  night: "var(--sw-night, #00101f)",
  day: "var(--sw-daylight, #a8cae0)",
  paper: "var(--sw-paper, #fcfcfc)",
  sunrise: "var(--sw-sunrise, #f0d890)",
  flood: "var(--sw-flood, #4a9fd8)",
  ebb: "var(--sw-ebb, #e8a33d)",
  sun: "var(--sw-sun, #f0c860)",
  high: "var(--sw-graph-high, #2dd4bf)",
  low: "var(--sw-graph-low, #fbbf24)",
};

/** The horizontal mapping: a constant 18 px per hour from the first sample. */
export interface Geometry {
  start: number;
  end: number;
  width: number;
  x: (t: number) => number;
}

/** What a track draws with: the shared rows and masks, placed on its own layers. */
export interface StripKit {
  id: string;
  g: Geometry;
  now: number;
  /** Event marks and labels for a moment already passed fade to 45%. */
  past: (t: number) => number;
  /** The mask that dims everything left of now to 35%. */
  pastMask: string;
  /** Day and night shading, clipped beneath `curve` (an SVG path) and fading down the strip. */
  shade: (curve: string) => ReactNode;
  /** The event-time row. */
  eventTimes: (times: number[]) => ReactNode;
  /** Day names, dates, sun times and sun dots. */
  dayChrome: ReactNode;
}

export interface Lead {
  content: ReactNode;
  /** The lead and its dated clock, read as one: the slider's value. */
  spoken: string;
}

export interface Comment {
  content: ReactNode;
  spoken: string;
  /** Where activating the pill goes. */
  to?: number;
  /** Ink for a warning about the selected instant rather than the next stop. */
  color?: string;
}

/** One kind of strip: its data span, curve, lead, and stops. */
export interface Track {
  label: string;
  start: number;
  end: number;
  /** The curve's y at `t`, which the riding dot follows. */
  y: (t: number) => number;
  /** The riding dot's diameter and glow radius. */
  dot: { size: number; glow: number };
  /** The water stops the commentary walks. */
  stops: Stop[];
  /** The magnet's targets among the reachable stops, inside [first, last]. */
  targets: (stops: Stop[], first: number, last: number) => number[];
  lead: (t: number) => Lead | undefined;
  /** Replaces the plain next-stop commentary, as the fast-tide warning does. */
  comment?: (t: number, stops: Stop[]) => Comment | undefined;
  draw: (kit: StripKit) => ReactNode;
}

export interface ScrubberProps {
  track: Track;
  timezone: string;
  latitude: number;
  longitude: number;
  locale?: string;
  now?: number;
  className?: string;
  /** Called with every change to the time under the center line. */
  onSelect?: (time: number) => void;
  /** A new object moves the selection to `time`, once data covers it. */
  moveTo?: { time: number };
  /** Called when the Now pill is activated, with the fresh now. */
  onNow?: (now: number) => void;
  /** Called with the selection and the viewport's span in ms as either changes. */
  onView?: (time: number, span: number) => void;
}

const SYMBOL = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** SF Symbols `sunrise` and `sunset`: a sun on the horizon with an arrow up or down. */
export function SunPath({ rising }: { rising: boolean }) {
  return (
    <g {...SYMBOL}>
      <path d="M1 11h14M4.5 11a3.5 3.5 0 0 1 7 0M2.5 8l1 .6M13.5 8l-1 .6M8 5.6v1" />
      <path d={rising ? "M8 4.5V0.8M6.3 2.4 8 0.8 9.7 2.4" : "M8 0.8v3.7M6.3 2.9 8 4.5 9.7 2.9"} />
    </g>
  );
}

/** SF Symbols `arrow.forward` / `arrow.backward`. */
function ArrowPath({ forward }: { forward: boolean }) {
  return <path {...SYMBOL} d={forward ? "M2 6h11M9 2l4 4-4 4" : "M14 6H3M7 2 3 6l4 4"} />;
}

export function Arrow({ forward }: { forward: boolean }) {
  return (
    <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden="true">
      <ArrowPath forward={forward} />
    </svg>
  );
}

/** The water going both ways: SF Symbol arrow.right.and.line.vertical.and.arrow.left. */
export function SlackGlyph() {
  return (
    <svg
      width={16}
      height={12}
      viewBox="0 0 16 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1v10M1 6h4.5M3.5 4l2 2-2 2M15 6h-4.5M12.5 4l-2 2 2 2" />
    </svg>
  );
}

/** SF Symbols `arrow.up` / `arrow.down`. */
export function UpDownArrow({ up, size = 12 }: { up: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path {...SYMBOL} d={up ? "M6 10.5V1.5M2 5.5l4-4 4 4" : "M6 1.5v9M2 6.5l4 4 4-4"} />
    </svg>
  );
}

/** The symbol a commentary stop carries, after the app's `commentaryEventStop`. */
export function StopIcon({ kind }: { kind: StopKind }) {
  if (kind === "Slack") return <SlackGlyph />;
  if (kind === "High" || kind === "Low") return <UpDownArrow up={kind === "High"} />;
  if (kind !== "Sunrise" && kind !== "Sunset")
    return <Arrow forward={kind === "Flood" || kind === "Max flood"} />;
  return (
    <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden="true">
      <SunPath rising={kind === "Sunrise"} />
    </svg>
  );
}

/** The plain commentary: the next water or sun stop with its countdown. */
export function nextStopComment(t: number, stops: Stop[], locale?: string): Comment | undefined {
  const c = commentary(t, stops, locale);
  return (
    c && {
      content: (
        <>
          {c.stop.label}
          <StopIcon kind={c.stop.label} />
          {c.duration}
        </>
      ),
      spoken: c.spoken,
      to: c.stop.time,
    }
  );
}

interface StripProps {
  track: Track;
  daysList: Day[];
  bands: Band[];
  now: number;
  timezone: string;
  locale?: string;
}

const Strip = memo(function Strip({ track, daysList, bands, now, timezone, locale }: StripProps) {
  const id = useId().replace(/\W/g, "");
  const g = useMemo(() => geometry(track.start, track.end), [track.start, track.end]);
  const nowX = Math.min(g.width, Math.max(0, g.x(now)));
  const past = (t: number) => (t < now ? 0.45 : 1);

  const kit: StripKit = {
    id,
    g,
    now,
    past,
    pastMask: `url(#${id}past)`,
    shade: (curve) => (
      <>
        <defs>
          <mask id={`${id}shade`} maskUnits="userSpaceOnUse">
            {/* Under the curve only, so the line is the shade's top edge. */}
            <path
              d={`${curve}L${g.width} ${G.height}L0 ${G.height}Z`}
              fill={`url(#${id}shadeFade)`}
            />
          </mask>
        </defs>
        <g mask={`url(#${id}shade)`}>
          {bands.map((b, i) => (
            <rect
              key={i}
              x={g.x(b.from - FADE_MS)}
              width={Math.max(0, g.x(b.to + FADE_MS) - g.x(b.from - FADE_MS))}
              height={G.height}
              fill={`url(#${id}band${i})`}
              opacity={b.night ? 0.7 : 0.08}
            />
          ))}
        </g>
      </>
    ),
    eventTimes: (times) =>
      times.map((time) => (
        <text
          key={time}
          x={g.x(time)}
          y={G.eventTimeY}
          textAnchor="middle"
          fill={C.foam}
          opacity={0.7 * past(time)}
          fontSize={12}
          fontWeight={500}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {chartTime(time, timezone, locale)}
        </text>
      )),
    dayChrome: daysList.map((d) => {
      const mid = dayAnchor(d, bands, timezone);
      return (
        <g key={d.start}>
          {mid > g.start && mid < g.end && (
            <>
              <text
                x={g.x(mid)}
                y={G.dayY}
                textAnchor="middle"
                fill={C.foam}
                fillOpacity={0.85}
                fontSize={13}
                fontWeight={600}
              >
                {dayLabel(d.start, now, timezone, locale)}
              </text>
              <text
                x={g.x(mid)}
                y={G.dateY}
                textAnchor="middle"
                fill={C.foam}
                fillOpacity={0.48}
                fontSize={10}
                fontWeight={500}
                fontFamily="ui-monospace, monospace"
              >
                {shortDate(d.start, timezone, locale)}
              </text>
            </>
          )}
          {(
            [
              [d.sunrise, "Sunrise"],
              [d.sunset, "Sunset"],
            ] as const
          ).map(([t, kind]) => {
            if (!t || t <= g.start || t >= g.end) return null;
            const clock = chartTime(t, timezone, locale);
            // ponytail: monospace advance estimated at 0.6em; measure if a font breaks it.
            const width = 13 + 4 + clock.length * 6.6;
            const left = g.x(t) - width / 2;
            return (
              <g key={kind} color={C.sunrise}>
                <g transform={`translate(${left} ${G.dayY - 10}) scale(0.8125)`}>
                  <SunPath rising={kind === "Sunrise"} />
                </g>
                <text
                  x={left + 17}
                  y={G.dayY}
                  fill={C.sunrise}
                  fontSize={11}
                  fontWeight={500}
                  fontFamily="ui-monospace, monospace"
                >
                  {clock}
                </text>
                <circle cx={g.x(t)} cy={G.sunDotY} r={3.5} fill={C.sun} />
              </g>
            );
          })}
        </g>
      );
    }),
  };

  return (
    <svg width={g.width} height={G.height} style={{ display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}shadeFade`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={G.plotTop}
          y2={G.height}
        >
          <stop offset="0.35" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        {bands.map((b, i) => {
          const f = (2 * FADE_MS) / (b.to - b.from + 2 * FADE_MS);
          const color = b.night ? C.night : C.day;
          return (
            <linearGradient key={i} id={`${id}band${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopOpacity={0} stopColor={color} />
              <stop offset={Math.min(0.5, f)} stopColor={color} />
              <stop offset={Math.max(0.5, 1 - f)} stopColor={color} />
              <stop offset="1" stopOpacity={0} stopColor={color} />
            </linearGradient>
          );
        })}
        <mask id={`${id}past`} maskUnits="userSpaceOnUse">
          <rect width={nowX} height={G.height} fill="#fff" fillOpacity={0.35} />
          <rect x={nowX} width={g.width - nowX} height={G.height} fill="#fff" />
        </mask>
      </defs>
      {track.draw(kit)}
    </svg>
  );
});

export function geometry(start: number, end: number): Geometry {
  return {
    start,
    end,
    width: ((end - start) / HOUR) * PX_PER_HOUR,
    x: (t) => ((t - start) / HOUR) * PX_PER_HOUR,
  };
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The empty strip, in place of one with too few samples to scale time. */
export function EmptyStrip({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center text-sm opacity-80 ${className ?? ""}`}
      style={{ height: G.height, background: C.canvas, color: "#fff" }}
    >
      {message}
    </div>
  );
}

/**
 * A continuously scrolling strip under a fixed reading line, after the app's
 * scrubber: the instant under the center line drives the lead reading, and
 * the pills name the next stop and the way back to now.
 */
export function Scrubber({
  track,
  timezone,
  latitude,
  longitude,
  locale,
  now: nowProp,
  className,
  onSelect,
  moveTo,
  onNow,
  onView,
}: ScrubberProps) {
  const [clock, setClock] = useState(() => nowProp ?? Date.now());
  const now = nowProp ?? clock;
  const g = useMemo(() => geometry(track.start, track.end), [track.start, track.end]);
  // A day either side, so the first night and the last have both their sun events.
  const daysList = useMemo(
    () => days(g.start - 24 * HOUR, g.end + 24 * HOUR, timezone, latitude, longitude),
    [g.start, g.end, timezone, latitude, longitude],
  );
  const bands = useMemo(() => sunBands(daysList), [daysList]);
  /** The strip's width in px, measured on open and on resize. */
  const [width, setWidth] = useState(0);
  const span = (width / PX_PER_HOUR) * HOUR;
  // Only stops the center line can reach are named or snapped to.
  const first = reachable(g.start, g.start, g.end, span);
  const last = reachable(g.end, g.start, g.end, span);
  const stops = useMemo(
    () => scrubberStops(track.stops, daysList, first, last),
    [track.stops, daysList, first, last],
  );
  const targets = useMemo(() => track.targets(stops, first, last), [track, stops, first, last]);

  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(now);
  const [resting, setResting] = useState(false);
  const restTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A person scrolled since the last rest, so the magnet runs when it comes. */
  const userMoved = useRef(false);
  /** The exact instant a programmatic move is landing on. */
  const target = useRef<number | undefined>(undefined);
  /** A requested instant the loaded data doesn't reach yet. */
  const pending = useRef<number | undefined>(undefined);
  const opening = useRef<number | undefined>(undefined);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const nowRef = useRef(now);
  nowRef.current = now;

  const viewport = () => (scroller.current!.clientWidth / PX_PER_HOUR) * HOUR;
  const centerTime = useCallback(() => {
    const el = scroller.current!;
    return g.start + ((el.scrollLeft + el.clientWidth / 2) / PX_PER_HOUR) * HOUR;
  }, [g]);
  const leftFor = useCallback(
    (t: number) => g.x(t) - (scroller.current?.clientWidth ?? 0) / 2,
    [g],
  );

  const restSoon = useCallback((onRest: () => void) => {
    setResting(false);
    clearTimeout(restTimer.current);
    restTimer.current = setTimeout(onRest, REST_MS);
  }, []);

  const stopOpening = () => {
    if (opening.current !== undefined) cancelAnimationFrame(opening.current);
    opening.current = undefined;
  };

  // Every rest reads this so the timer never calls a stale closure.
  const onRestRef = useRef<() => void>(null!);

  /** Bring `t` under the centerline: the newest request wins, clamped to a reachable offset. Returns whether the strip moves. */
  const goTo = useCallback(
    (t: number, animate: boolean): boolean => {
      const el = scroller.current!;
      stopOpening();
      userMoved.current = false;
      const dest = reachable(t, g.start, g.end, viewport());
      target.current = dest;
      const left = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, leftFor(dest)));
      if (Math.abs(left - el.scrollLeft) < 0.5) {
        target.current = undefined;
        setSelected(dest);
        return false;
      }
      const smooth = animate && rides(centerTime(), dest, prefersReducedMotion());
      el.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
      if (!smooth) setSelected(dest);
      restSoon(() => onRestRef.current());
      return true;
    },
    [g, leftFor, centerTime, restSoon],
  );

  /** A host's request: goes now, and again once data reaches it. */
  const request = (t: number) => {
    pending.current = t < g.start || t > g.end ? t : undefined;
    goTo(t, true);
  };

  /** Stop any opening, glide, or momentum where the strip is now. */
  const stopMotion = () => {
    const el = scroller.current!;
    stopOpening();
    target.current = undefined;
    el.scrollTo({ left: el.scrollLeft, behavior: "instant" });
  };

  onRestRef.current = () => {
    const landing = target.current;
    target.current = undefined;
    if (landing !== undefined && Math.abs(centerTime() - landing) < UNIT_MS) {
      // A programmatic move lands on a whole pixel; read its exact instant.
      setSelected(landing);
    } else if (landing !== undefined || userMoved.current) {
      // A ride that stopped short of its target rests like a person's scroll.
      userMoved.current = false;
      const snap = magnetTarget(targets, centerTime());
      if (snap !== undefined && goTo(snap, true)) return;
    }
    setResting(true);
  };

  const onScroll = () => {
    const t = centerTime();
    const landing = target.current;
    setSelected(
      landing !== undefined && Math.abs(t - landing) < UNIT_MS
        ? landing
        : Math.min(g.end, Math.max(g.start, t)),
    );
    restSoon(() => onRestRef.current());
  };

  // The Now pill unmounts and the commentary pill hides once moving, so keyboard focus moves to the strip.
  const focusSlider = () => scroller.current!.focus({ preventScroll: true });

  const markUserMove = () => {
    stopOpening();
    target.current = undefined;
    pending.current = undefined;
    userMoved.current = true;
  };

  useIsomorphicLayoutEffect(() => setWidth(scroller.current!.clientWidth), []);

  // Open two hours before now and move linearly to it, unless motion is reduced.
  const opened = useRef(false);
  useIsomorphicLayoutEffect(() => {
    const el = scroller.current;
    if (!el || opened.current) return;
    opened.current = true;
    const to = reachable(now, g.start, g.end, viewport());
    target.current = to;
    if (prefersReducedMotion()) {
      el.scrollLeft = leftFor(to);
      setSelected(to);
      restSoon(() => onRestRef.current());
      return;
    }
    const from = reachable(now - OPEN_FROM_MS, g.start, g.end, viewport());
    el.scrollLeft = leftFor(from);
    setSelected(from);
    const began = performance.now();
    const frame = (time: number) => {
      const f = Math.min(1, Math.max(0, (time - began) / OPEN_DURATION_MS));
      el.scrollLeft = leftFor(from + (to - from) * f);
      opening.current = f < 1 ? requestAnimationFrame(frame) : undefined;
    };
    opening.current = requestAnimationFrame(frame);
    restSoon(() => onRestRef.current());
  }, [now, g, leftFor, restSoon]);

  // A width change keeps the selected time under the new center.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      setWidth(width);
      // The opening's frames already recompute against the new width.
      if (opening.current !== undefined) return;
      userMoved.current = false;
      target.current = selectedRef.current;
      el.scrollTo({ left: leftFor(selectedRef.current), behavior: "instant" });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [leftFor]);

  // New data with a different span keeps the selection, clamped into it, or takes a request it now reaches.
  const range = useRef(g);
  useIsomorphicLayoutEffect(() => {
    const prev = range.current;
    range.current = g;
    if (prev.start === g.start && prev.end === g.end) return;
    const wanted = pending.current;
    if (wanted !== undefined && wanted >= g.start && wanted <= g.end) {
      pending.current = undefined;
      goTo(wanted, false);
    } else goTo(selectedRef.current, false);
  }, [g, goTo]);

  // Now is sampled on open, on the Now pill, and on returning to the page;
  // never on a timer. A selection that was home follows it.
  useEffect(() => {
    if (nowProp !== undefined) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const fresh = Date.now();
      const home =
        Math.abs(selectedRef.current - reachable(nowRef.current, g.start, g.end, viewport())) <=
        NEAR_NOW_MS;
      setClock(fresh);
      if (home) goTo(fresh, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [nowProp, goTo, g]);

  useEffect(() => () => clearTimeout(restTimer.current), []);

  useEffect(() => onSelect?.(selected), [onSelect, selected]);
  useEffect(() => onView?.(selected, span), [onView, selected, span]);
  // A request is an object so tapping the same row twice still moves there.
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (moveTo) requestRef.current(moveTo.time);
  }, [moveTo]);

  // Mouse drag; touch and trackpads scroll natively. A touch-down alone moves nothing.
  const drag = useRef<{ x: number; left: number; moved: boolean } | undefined>(undefined);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false };
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    let d = drag.current;
    if (!d || e.pointerType !== "mouse") return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 4) {
      // The drag continues from wherever the strip is when panning starts.
      markUserMove();
      d = drag.current = { x: d.x, left: scroller.current!.scrollLeft, moved: true };
    }
    if (d.moved) scroller.current!.scrollLeft = d.left - (e.clientX - d.x);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d || d.moved) return;
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    const t = g.start + ((el.scrollLeft + e.clientX - rect.left) / PX_PER_HOUR) * HOUR;
    stopMotion();
    pending.current = undefined;
    if (e.clientY - rect.top < DAY_ROW_Y) {
      goTo(magnetTarget(targets, t) ?? t, true);
      return;
    }
    // The day row: a sun event centers; a date has no picker here, so it only stops motion.
    const sun = stops
      .filter((s) => s.label === "Sunrise" || s.label === "Sunset")
      .map((s) => s.time);
    const hit = dayRowHit(
      sun,
      daysList.map((d) => dayAnchor(d, bands, timezone)),
      t,
    );
    if (hit?.sun) goTo(hit.time, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    pending.current = undefined;
    const forward = e.key === "ArrowRight";
    if (e.shiftKey) {
      const next = adjacentTarget(targets, selected, forward);
      if (next !== undefined) goTo(next, false);
    } else {
      goTo(selected + (forward ? 5 : -5) * 60_000, false);
    }
  };

  const lead = track.lead(selected);
  const comment = track.comment
    ? track.comment(selected, stops)
    : nextStopComment(selected, stops, locale);
  // Where the Now pill goes: now, or as near as a strip this wide can center.
  const home = reachable(now, g.start, g.end, span);
  const awayFromNow = Math.abs(selected - home) > NEAR_NOW_MS;

  const fade = "transition-opacity duration-200 motion-reduce:transition-none";
  const pillButton = `absolute flex min-h-[44px] min-w-[44px] items-center justify-center cursor-pointer ${fade}`;
  const capsule =
    "flex items-center gap-1 rounded-full px-3 text-xs font-semibold tabular-nums text-white bg-white/12 backdrop-blur-md border border-white/15";
  const pillStyle = {
    top: G.pillTop + PILL_HEIGHT / 2 - 22,
    opacity: resting ? 1 : 0,
    pointerEvents: resting ? "auto" : "none",
  } as const;

  return (
    <div
      className={`relative select-none overflow-hidden ${className ?? ""}`}
      style={{
        height: G.height,
        background: "var(--sw-strip-ground, var(--sw-canvas, #05122a))",
        color: "#fff",
      }}
    >
      <div
        ref={scroller}
        role="slider"
        tabIndex={0}
        aria-label={track.label}
        aria-valuemin={g.start}
        aria-valuemax={g.end}
        aria-valuenow={Math.round(selected)}
        aria-valuetext={lead?.spoken}
        className="scrollbar-hide h-full overflow-x-auto overflow-y-hidden outline-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50"
        style={{ touchAction: "pan-x pan-y", overscrollBehaviorX: "none" }}
        onScroll={onScroll}
        onWheel={(e) => {
          // A vertical wheel scrolls the page, not the strip.
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) markUserMove();
        }}
        onTouchMove={markUserMove}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = undefined)}
        onKeyDown={onKeyDown}
      >
        <Strip
          track={track}
          daysList={daysList}
          bands={bands}
          now={now}
          timezone={timezone}
          locale={locale}
        />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {lead && (
          <div className="absolute inset-x-0 top-3 flex flex-col items-center gap-1 text-center">
            <span className="sr-only">{lead.spoken}</span>
            {lead.content}
          </div>
        )}

        <div
          className={`absolute w-px bg-white ${fade}`}
          style={{
            left: "50%",
            top: G.topPad,
            height: G.plotBottom - G.topPad,
            opacity: resting && comment ? 0.18 : 0,
          }}
        />
        <div
          className="absolute rounded-full bg-white"
          style={{
            left: "50%",
            top: track.y(selected),
            width: track.dot.size,
            height: track.dot.size,
            transform: "translate(-50%, -50%)",
            boxShadow: `0 0 ${track.dot.glow}px rgb(255 255 255 / 0.9)`,
          }}
        />

        {comment && (
          <button
            type="button"
            tabIndex={resting ? 0 : -1}
            className={pillButton}
            style={{ ...pillStyle, left: "50%", transform: "translateX(-50%)" }}
            aria-label={comment.spoken}
            onClick={() => {
              if (comment.to !== undefined) goTo(comment.to, true);
              focusSlider();
            }}
          >
            <span className={capsule} style={{ height: PILL_HEIGHT, color: comment.color }}>
              {comment.content}
            </span>
          </button>
        )}
        {awayFromNow && (
          <button
            type="button"
            tabIndex={resting ? 0 : -1}
            className={pillButton}
            style={{ ...pillStyle, [selected > home ? "left" : "right"]: 16 }}
            aria-label="Return to now"
            onClick={() => {
              const fresh = nowProp ?? Date.now();
              setClock(fresh);
              onNow?.(fresh);
              request(fresh);
              focusSlider();
            }}
          >
            <span className={capsule} style={{ height: PILL_HEIGHT }}>
              {selected > home ? (
                <>
                  <Arrow forward={false} />
                  Now
                </>
              ) : (
                <>
                  Now
                  <Arrow forward />
                </>
              )}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
