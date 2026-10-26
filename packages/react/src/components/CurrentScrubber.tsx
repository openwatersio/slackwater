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
} from "react";

import type { CurrentEvent, CurrentTimelineEntry } from "../types.js";
import {
  DEFAULT_SLACK_THRESHOLD,
  EMPTY_MESSAGE,
  commentary,
  compass16,
  currentStops,
  formatSpeed,
  isDotRun,
  readCurrent,
  runCenter,
  scrubberStops,
  slackRuns,
  snapTargets,
  speedAt,
  speedColor,
  spokenReading,
  threadOpacity,
  type Directions,
  type SlackWindow,
  type StopKind,
} from "../utils/current.js";
import {
  NEAR_NOW_MS,
  PX_PER_HOUR,
  UNIT_MS,
  adjacentTarget,
  awayFromEdges,
  dayRowHit,
  magnetTarget,
  reachable,
  rides,
  thinLabels,
} from "../utils/scrubber.js";
import {
  chartTime,
  dayAnchor,
  dayLabel,
  days,
  leadTime,
  shortDate,
  sunBands,
  type Band,
  type Day,
} from "../utils/time.js";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const HOUR = 3_600_000;
const G = {
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
const ZERO_Y = (G.plotTop + G.plotBottom) / 2;
/** Speeds reach 3 units short of the plot's edges. */
const AMPLITUDE = (G.plotBottom - G.plotTop) / 2 - 3;
/** Taps below this line belong to the day, date, and sun row. */
const DAY_ROW_Y = (G.eventTimeY + G.dayY) / 2;
const PILL_HEIGHT = 30;
const REST_MS = 450;
const OPEN_FROM_MS = 2 * HOUR;
const OPEN_DURATION_MS = 650;
const FADE_MS = 0.75 * HOUR;
const SLACK_WIDTH = 3.5;
/** Clear space around slack-run caps, slack dots, and the now dot. */
const HALO_GAP = 2.5;

const C = {
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
};

export interface CurrentScrubberProps {
  timeline: CurrentTimelineEntry[];
  events: CurrentEvent[];
  timezone: string;
  latitude: number;
  longitude: number;
  directions?: Directions;
  /** Boat-speed threshold for slack windows, in knots. */
  threshold?: number;
  /** BCP 47 locale for clocks and dates; defaults to the reader's. */
  locale?: string;
  /** The current instant; defaults to the clock. Pass it to render deterministically (prerendering). */
  now?: number;
  className?: string;
}

interface Geometry {
  start: number;
  end: number;
  width: number;
  x: (t: number) => number;
  y: (v: number) => number;
}

function geometry(timeline: CurrentTimelineEntry[]): Geometry {
  const start = timeline[0].time.getTime();
  const end = timeline[timeline.length - 1].time.getTime();
  // ponytail: fixed symmetric fit over the whole window; the app's vertical governor
  // (fit the visible span, glide on change) comes when the endless window does.
  const max = Math.max(0.01, ...timeline.map((p) => Math.abs(p.speed))) * 1.05;
  return {
    start,
    end,
    width: ((end - start) / HOUR) * PX_PER_HOUR,
    x: (t) => ((t - start) / HOUR) * PX_PER_HOUR,
    y: (v) => ZERO_Y - Math.max(-1, Math.min(1, v / max)) * AMPLITUDE,
  };
}

/** A ↑ rotated to a bearing in degrees true. */
function SetArrow({ direction, size = 12 }: { direction: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-6 -6 12 12" aria-hidden="true">
      <path
        d="M0 -5 L0 5 M-3.5 -1.5 L0 -5 L3.5 -1.5"
        transform={`rotate(${direction})`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The water going both ways: SF Symbol arrow.right.and.line.vertical.and.arrow.left. */
function SlackGlyph() {
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

const SYMBOL = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** SF Symbols `sunrise` and `sunset`: a sun on the horizon with an arrow up or down. */
function SunPath({ rising }: { rising: boolean }) {
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

function Arrow({ forward }: { forward: boolean }) {
  return (
    <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden="true">
      <ArrowPath forward={forward} />
    </svg>
  );
}

/** The symbol a commentary stop carries, after the app's `commentaryEventStop`. */
function StopIcon({ kind }: { kind: StopKind }) {
  if (kind === "Slack") return <SlackGlyph />;
  if (kind !== "Sunrise" && kind !== "Sunset")
    return <Arrow forward={kind === "Flood" || kind === "Max flood"} />;
  return (
    <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden="true">
      <SunPath rising={kind === "Sunrise"} />
    </svg>
  );
}

interface StripProps {
  g: Geometry;
  timeline: CurrentTimelineEntry[];
  events: CurrentEvent[];
  runs: SlackWindow[];
  daysList: Day[];
  bands: Band[];
  now: number;
  timezone: string;
  locale?: string;
}

const Strip = memo(function Strip({
  g,
  timeline,
  events,
  runs,
  daysList,
  bands,
  now,
  timezone,
  locale,
}: StripProps) {
  const id = useId().replace(/\W/g, "");
  const nowX = Math.min(g.width, Math.max(0, g.x(now)));
  const curve = timeline
    .map((p, i) => `${i ? "L" : "M"}${g.x(p.time.getTime()).toFixed(1)} ${g.y(p.speed).toFixed(1)}`)
    .join("");
  // A slack run is its own path between the interpolated window edges, so its round caps show.
  const run = (w: SlackWindow) => {
    const a = w.start.getTime();
    const b = w.end.getTime();
    const times = [a, ...timeline.map((p) => p.time.getTime()).filter((t) => t > a && t < b), b];
    return times
      .map(
        (t, i) => `${i ? "L" : "M"}${g.x(t).toFixed(1)} ${g.y(speedAt(timeline, t)!).toFixed(1)}`,
      )
      .join("");
  };
  const area = `${curve}L${g.width} ${ZERO_Y}L0 ${ZERO_Y}Z`;
  const step = Math.max(1, Math.floor(timeline.length / 600));
  const threadStops = timeline.filter((_, i) => i % step === 0);

  const strokes = runs.filter((w) => !isDotRun(w));
  // Runs draw to the edges; only marks and labels keep clear of them.
  const dots = runs
    .filter(isDotRun)
    .map((w) => ({ time: runCenter(w), y: g.y(speedAt(timeline, runCenter(w))!) }));
  const maxima = awayFromEdges(
    events.filter((e) => e.kind !== "slack").map((e) => ({ ...e, time: e.time.getTime() })),
    g.start,
    g.end,
  );
  const eventTimes = thinLabels(
    awayFromEdges(
      runs.map((w) => ({ time: isDotRun(w) ? runCenter(w) : w.start.getTime() })),
      g.start,
      g.end,
    ),
  );

  const nowSpeed = now >= g.start && now <= g.end ? speedAt(timeline, now) : undefined;
  const past = (t: number) => (t < now ? 0.45 : 1);

  return (
    <svg width={g.width} height={G.height} style={{ display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}fill`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={G.plotTop}
          y2={ZERO_Y}
        >
          <stop offset="0" stopColor={C.line} stopOpacity={0.5} />
          <stop offset="1" stopColor={C.line} stopOpacity={0} />
        </linearGradient>
        {/* Only the flood lobes: an ebb lobe's curve-to-zero area lies above the curve, where a tide chart has no fill. */}
        <clipPath id={`${id}flood`}>
          <rect width={g.width} height={ZERO_Y} />
        </clipPath>
        <linearGradient
          id={`${id}thread`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2={g.width}
          y1="0"
          y2="0"
        >
          {threadStops.map((p) => (
            <stop
              key={p.time.getTime()}
              offset={g.x(p.time.getTime()) / g.width}
              stopColor={speedColor(p.speed)}
              stopOpacity={threadOpacity(p.speed)}
            />
          ))}
        </linearGradient>
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
        <mask id={`${id}shade`} maskUnits="userSpaceOnUse">
          {/* Under the curve only, so the line is the shade's top edge. */}
          <path
            d={`${curve}L${g.width} ${G.height}L0 ${G.height}Z`}
            fill={`url(#${id}shadeFade)`}
          />
        </mask>
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
        {/* The line leaves room for each run: the run's body, plus a halo
            around its round end caps only, so the gap follows the curve. */}
        <mask id={`${id}track`} maskUnits="userSpaceOnUse" fill="none">
          <rect width={g.width} height={G.height} fill="#fff" />
          {strokes.map((w) => (
            <g key={w.start.getTime()}>
              <path
                d={run(w)}
                stroke="#000"
                strokeWidth={SLACK_WIDTH + 2 * HALO_GAP}
                strokeLinecap="round"
              />
              <path
                d={run(w)}
                stroke="#fff"
                strokeWidth={SLACK_WIDTH + 2 * HALO_GAP}
                strokeLinecap="butt"
              />
              <path d={run(w)} stroke="#000" strokeWidth={SLACK_WIDTH} strokeLinecap="butt" />
            </g>
          ))}
        </mask>
        {/* Dots punch through everything drawn beneath them to the ground. */}
        <mask id={`${id}halo`} maskUnits="userSpaceOnUse">
          <rect width={g.width} height={G.height} fill="#fff" />
          {dots.map((d) => (
            <circle key={d.time} cx={g.x(d.time)} cy={d.y} r={2.5 + HALO_GAP} fill="#000" />
          ))}
          {nowSpeed !== undefined && (
            <circle cx={g.x(now)} cy={g.y(nowSpeed)} r={3.5 + HALO_GAP} fill="#000" />
          )}
        </mask>
      </defs>

      <g mask={`url(#${id}halo)`}>
        <path d={area} fill={`url(#${id}fill)`} clipPath={`url(#${id}flood)`} />
        <g mask={`url(#${id}shade)`}>
          {bands.map((b, i) => (
            <rect
              key={i}
              x={g.x(b.from - FADE_MS)}
              width={Math.max(0, g.x(b.to + FADE_MS) - g.x(b.from - FADE_MS))}
              height={G.height}
              fill={`url(#${id}band${i})`}
              opacity={b.night ? 0.7 : 0.14}
            />
          ))}
        </g>
        <line
          x1={0}
          x2={g.width}
          y1={ZERO_Y}
          y2={ZERO_Y}
          stroke={C.foam}
          strokeOpacity={0.35}
          strokeDasharray="1 3"
        />

        <g mask={`url(#${id}past)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g mask={`url(#${id}track)`}>
            <path d={curve} stroke={C.line} strokeWidth={2.5} />
            <path d={curve} stroke={`url(#${id}thread)`} strokeWidth={2} />
          </g>
          {strokes.map((w) => (
            <path key={w.start.getTime()} d={run(w)} stroke={C.go} strokeWidth={SLACK_WIDTH} />
          ))}
        </g>
      </g>

      {eventTimes.map(({ time }) => (
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
      ))}

      {dots.map((d) => (
        <circle key={d.time} cx={g.x(d.time)} cy={d.y} r={2.5} fill={C.go} opacity={past(d.time)} />
      ))}

      {maxima.map((e) => {
        // Hangs toward the zero line: the set arrow nearest the peak, the speed beyond it.
        const toward = e.speed >= 0 ? 1 : -1;
        const y = g.y(e.speed) + toward * 23;
        return (
          <g
            key={e.time}
            transform={`translate(${g.x(e.time)} ${y})`}
            opacity={past(e.time)}
            color={C.foam}
          >
            <text
              y={toward * 7}
              textAnchor="middle"
              dominantBaseline="central"
              fill={C.foam}
              fontSize={18}
              fontWeight={600}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatSpeed(e.speed, locale)}
            </text>
            {e.direction !== undefined && (
              <g transform={`translate(0 ${-toward * 8})`}>
                <path
                  d="M0 -5 L0 5 M-3.5 -1.5 L0 -5 L3.5 -1.5"
                  transform={`rotate(${e.direction})`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}
          </g>
        );
      })}

      {daysList.map((d) => {
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
      })}

      {nowSpeed !== undefined && <circle cx={g.x(now)} cy={g.y(nowSpeed)} r={3.5} fill={C.paper} />}
    </svg>
  );
});

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A continuously scrolling current strip under a fixed reading line, after the
 * app's scrubber: the instant under the center line drives the lead reading,
 * and the pills name the next stop and the way back to now.
 */
export function CurrentScrubber(props: CurrentScrubberProps) {
  // The strip scales time across its first and last samples, so it needs two.
  if (props.timeline.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-sm opacity-80 ${props.className ?? ""}`}
        style={{ height: G.height, background: C.canvas, color: "#fff" }}
      >
        {EMPTY_MESSAGE}
      </div>
    );
  }
  return <Scrubber {...props} />;
}

function Scrubber({
  timeline,
  events,
  timezone,
  latitude,
  longitude,
  directions = {},
  threshold = DEFAULT_SLACK_THRESHOLD,
  locale,
  now: nowProp,
  className,
}: CurrentScrubberProps) {
  const [clock, setClock] = useState(() => nowProp ?? Date.now());
  const now = nowProp ?? clock;
  const g = useMemo(() => geometry(timeline), [timeline]);
  const runs = useMemo(() => slackRuns(timeline, events, threshold), [timeline, events, threshold]);
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
    () => scrubberStops(currentStops(timeline, events, runs), daysList, first, last),
    [timeline, events, runs, daysList, first, last],
  );
  const targets = useMemo(
    () => snapTargets(stops, events, runs, first, last),
    [stops, events, runs, first, last],
  );

  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(now);
  const [resting, setResting] = useState(false);
  const restTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A person scrolled since the last rest, so the magnet runs when it comes. */
  const userMoved = useRef(false);
  /** The exact instant a programmatic move is landing on. */
  const target = useRef<number | undefined>(undefined);
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

  /** Stop any opening, glide, or momentum where the strip is now. */
  const stopMotion = () => {
    const el = scroller.current!;
    stopOpening();
    target.current = undefined;
    el.scrollTo({ left: el.scrollLeft, behavior: "instant" });
  };

  onRestRef.current = () => {
    // A busy page delays the opening's frames past the rest delay; it rests once it lands.
    if (opening.current !== undefined) return restSoon(() => onRestRef.current());
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

  // New data with a different span keeps the selection, clamped into it.
  const range = useRef(g);
  useIsomorphicLayoutEffect(() => {
    const prev = range.current;
    range.current = g;
    if (prev.start !== g.start || prev.end !== g.end) goTo(selectedRef.current, false);
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
    const forward = e.key === "ArrowRight";
    if (e.shiftKey) {
      const next = adjacentTarget(targets, selected, forward);
      if (next !== undefined) goTo(next, false);
    } else {
      goTo(selected + (forward ? 5 : -5) * 60_000, false);
    }
  };

  const reading = readCurrent(selected, timeline, events, runs, directions);
  const comment = commentary(selected, stops, locale);
  // Where the Now pill goes: now, or as near as a strip this wide can center.
  const home = reachable(now, g.start, g.end, span);
  const awayFromNow = Math.abs(selected - home) > NEAR_NOW_MS;
  const ridingY = reading ? g.y(reading.speed) : ZERO_Y;
  const slack = reading?.state === "Slack";
  const spoken = reading ? spokenReading(reading, selected, timezone, locale) : undefined;

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
      style={{ height: G.height, background: C.canvas, color: "#fff" }}
    >
      <div
        ref={scroller}
        role="slider"
        tabIndex={0}
        aria-label="Current timeline"
        aria-valuemin={g.start}
        aria-valuemax={g.end}
        aria-valuenow={Math.round(selected)}
        aria-valuetext={spoken}
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
          g={g}
          timeline={timeline}
          events={events}
          runs={runs}
          daysList={daysList}
          bands={bands}
          now={now}
          timezone={timezone}
          locale={locale}
        />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {reading && (
          <div className="absolute inset-x-0 top-3 flex flex-col items-center gap-1 text-center">
            <span className="sr-only">{spoken}</span>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold" aria-hidden="true">
              <span className="font-medium opacity-85">{reading.state}</span>
              <span
                className="flex items-center gap-1"
                style={{ color: slack ? C.go : reading.speed >= 0 ? C.flood : C.ebb }}
              >
                {slack ? (
                  <SlackGlyph />
                ) : reading.direction !== undefined ? (
                  <>
                    <SetArrow direction={reading.direction} size={13} />
                    {compass16(reading.direction)}
                  </>
                ) : null}
              </span>
            </div>
            <div
              className="flex items-baseline gap-1 tabular-nums"
              style={{ fontFamily: "ui-rounded, system-ui, sans-serif" }}
              aria-hidden="true"
            >
              <span className="text-[44px] leading-none font-medium">
                {formatSpeed(reading.speed, locale)}
              </span>
              <span className="text-[22px] font-light">kn</span>
            </div>
            <div className="text-xs tabular-nums whitespace-pre" aria-hidden="true">
              {leadTime(selected, timezone, locale)}
            </div>
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
            top: ridingY,
            width: 10,
            height: 10,
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 3px rgb(255 255 255 / 0.9)",
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
              goTo(comment.stop.time, true);
              focusSlider();
            }}
          >
            <span className={capsule} style={{ height: PILL_HEIGHT }}>
              {comment.stop.label}
              <StopIcon kind={comment.stop.label} />
              {comment.duration}
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
              goTo(fresh, true);
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
