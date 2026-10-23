import { useMemo } from "react";

import type { CurrentEvent, CurrentTimelineEntry } from "../types.js";
import {
  DEFAULT_SLACK_THRESHOLD,
  EMPTY_MESSAGE,
  compass16,
  currentStops,
  formatSpeed,
  isDotRun,
  readCurrent,
  runCenter,
  slackRuns,
  snapTargets,
  speedAt,
  speedColor,
  spokenReading,
  threadOpacity,
  type Directions,
  type SlackWindow,
} from "../utils/current.js";
import { awayFromEdges, thinLabels } from "../utils/scrubber.js";
import { leadTime } from "../utils/time.js";
import {
  C,
  EmptyStrip,
  G,
  HALO_GAP,
  SET_ARROW_PATH,
  Scrubber,
  SlackGlyph,
  geometry,
  type ScrubberProps,
  type StripKit,
  type Track,
} from "./Scrubber.js";

const ZERO_Y = (G.plotTop + G.plotBottom) / 2;
/** Speeds reach 3 units short of the plot's edges. */
const AMPLITUDE = (G.plotBottom - G.plotTop) / 2 - 3;
const SLACK_WIDTH = 3.5;

export type { Directions };

export interface CurrentScrubberProps extends Pick<ScrubberProps, "onSelect" | "moveTo" | "onNow"> {
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

/** A ↑ rotated to a bearing in degrees true. */
export function SetArrow({ direction, size = 12 }: { direction: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-6 -6 12 12" aria-hidden="true">
      <path
        d={SET_ARROW_PATH}
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

/** A symmetric fit on the window's fastest water, about the zero line. */
function speedY(timeline: CurrentTimelineEntry[]) {
  // ponytail: fixed symmetric fit over the whole window; the app's vertical governor
  // (fit the visible span, glide on change) comes when the endless window does.
  const max = Math.max(0.01, ...timeline.map((p) => Math.abs(p.speed))) * 1.05;
  return (v: number) => ZERO_Y - Math.max(-1, Math.min(1, v / max)) * AMPLITUDE;
}

function drawCurrent(
  { id, g, now, past, pastMask, shade, eventTimes, dayChrome }: StripKit,
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  runs: SlackWindow[],
  y: (v: number) => number,
  locale?: string,
) {
  const curve = timeline
    .map((p, i) => `${i ? "L" : "M"}${g.x(p.time.getTime()).toFixed(1)} ${y(p.speed).toFixed(1)}`)
    .join("");
  // A slack run is its own path between the interpolated window edges, so its round caps show.
  const run = (w: SlackWindow) => {
    const a = w.start.getTime();
    const b = w.end.getTime();
    const times = [a, ...timeline.map((p) => p.time.getTime()).filter((t) => t > a && t < b), b];
    return times
      .map((t, i) => `${i ? "L" : "M"}${g.x(t).toFixed(1)} ${y(speedAt(timeline, t)!).toFixed(1)}`)
      .join("");
  };
  const area = `${curve}L${g.width} ${ZERO_Y}L0 ${ZERO_Y}Z`;
  const step = Math.max(1, Math.floor(timeline.length / 600));
  const threadStops = timeline.filter((_, i) => i % step === 0);

  const strokes = runs.filter((w) => !isDotRun(w));
  // Runs draw to the edges; only marks and labels keep clear of them.
  const dots = runs
    .filter(isDotRun)
    .map((w) => ({ time: runCenter(w), y: y(speedAt(timeline, runCenter(w))!) }));
  const maxima = awayFromEdges(
    events.filter((e) => e.kind !== "slack").map((e) => ({ ...e, time: e.time.getTime() })),
    g.start,
    g.end,
  );
  const times = thinLabels(
    awayFromEdges(
      runs.map((w) => ({ time: isDotRun(w) ? runCenter(w) : w.start.getTime() })),
      g.start,
      g.end,
    ),
  ).map((l) => l.time);

  const nowSpeed = now >= g.start && now <= g.end ? speedAt(timeline, now) : undefined;

  return (
    <>
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
            <circle cx={g.x(now)} cy={y(nowSpeed)} r={3.5 + HALO_GAP} fill="#000" />
          )}
        </mask>
      </defs>

      <g mask={`url(#${id}halo)`}>
        {/* The water: opaque from the curve to the plot floor, whatever the page behind. */}
        <path d={`${curve}L${g.width} ${G.plotBottom}L0 ${G.plotBottom}Z`} fill={C.canvas} />
        <path d={area} fill={`url(#${id}fill)`} clipPath={`url(#${id}flood)`} />
        {shade(curve)}
        <line
          x1={0}
          x2={g.width}
          y1={ZERO_Y}
          y2={ZERO_Y}
          stroke={C.foam}
          strokeOpacity={0.35}
          strokeDasharray="1 3"
        />

        <g mask={pastMask} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g mask={`url(#${id}track)`}>
            <path d={curve} stroke={C.line} strokeWidth={2.5} />
            <path d={curve} stroke={`url(#${id}thread)`} strokeWidth={2} />
          </g>
          {strokes.map((w) => (
            <path key={w.start.getTime()} d={run(w)} stroke={C.go} strokeWidth={SLACK_WIDTH} />
          ))}
        </g>
      </g>

      {eventTimes(times)}

      {dots.map((d) => (
        <circle key={d.time} cx={g.x(d.time)} cy={d.y} r={2.5} fill={C.go} opacity={past(d.time)} />
      ))}

      {maxima.map((e) => {
        // Hangs toward the zero line: the set arrow nearest the peak, the speed beyond it.
        const toward = e.speed >= 0 ? 1 : -1;
        const at = y(e.speed) + toward * 23;
        return (
          <g
            key={e.time}
            transform={`translate(${g.x(e.time)} ${at})`}
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
                  d={SET_ARROW_PATH}
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

      {dayChrome}

      {nowSpeed !== undefined && <circle cx={g.x(now)} cy={y(nowSpeed)} r={3.5} fill={C.paper} />}
    </>
  );
}

/**
 * A continuously scrolling current strip under a fixed reading line, after the
 * app's scrubber: the instant under the center line drives the lead reading,
 * and the pills name the next stop and the way back to now.
 */
export function CurrentScrubber(props: CurrentScrubberProps) {
  // The strip scales time across its first and last samples, so it needs two.
  if (props.timeline.length < 2) {
    return <EmptyStrip message={EMPTY_MESSAGE} className={props.className} />;
  }
  return <CurrentStrip {...props} />;
}

function CurrentStrip({
  timeline,
  events,
  timezone,
  latitude,
  longitude,
  directions,
  threshold = DEFAULT_SLACK_THRESHOLD,
  locale,
  now,
  className,
  onSelect,
  moveTo,
  onNow,
}: CurrentScrubberProps) {
  const flood = directions?.flood;
  const ebb = directions?.ebb;
  const track = useMemo((): Track => {
    const runs = slackRuns(timeline, events, threshold);
    const y = speedY(timeline);
    const g = geometry(timeline[0].time.getTime(), timeline[timeline.length - 1].time.getTime());
    const read = (t: number) => readCurrent(t, timeline, events, runs, { flood, ebb });
    return {
      label: "Current timeline",
      start: g.start,
      end: g.end,
      y: (t) => y(speedAt(timeline, t) ?? 0),
      dot: { size: 10, glow: 3 },
      stops: currentStops(timeline, events, runs),
      targets: (stops, first, last) => snapTargets(stops, events, runs, first, last),
      lead: (t) => {
        const reading = read(t);
        if (!reading) return undefined;
        const slack = reading.state === "Slack";
        return {
          spoken: spokenReading(reading, t, timezone, locale),
          content: (
            <>
              <div
                className="flex items-center gap-1.5 text-[13px] font-semibold"
                aria-hidden="true"
              >
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
                style={{ fontFamily: "var(--sw-font-rounded, ui-rounded, system-ui, sans-serif)" }}
                aria-hidden="true"
              >
                <span className="text-[44px] leading-none font-medium">
                  {formatSpeed(reading.speed, locale)}
                </span>
                <span className="text-[22px] font-light">kn</span>
              </div>
              <div className="text-xs tabular-nums whitespace-pre" aria-hidden="true">
                {leadTime(t, timezone, locale)}
              </div>
            </>
          ),
        };
      },
      draw: (kit) => drawCurrent(kit, timeline, events, runs, y, locale),
    };
  }, [timeline, events, threshold, flood, ebb, timezone, locale]);

  return (
    <Scrubber
      track={track}
      timezone={timezone}
      latitude={latitude}
      longitude={longitude}
      locale={locale}
      now={now}
      className={className}
      onSelect={onSelect}
      moveTo={moveTo}
      onNow={onNow}
    />
  );
}
