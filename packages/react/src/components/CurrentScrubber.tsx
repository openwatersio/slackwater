import { DEFAULT_SLACK_THRESHOLD, readCurrent, slackRuns, speedAt } from "@slackwater/engine";
import { useMemo } from "react";
import { useSetFormat } from "../provider.js";

import type { CurrentEvent, CurrentTimelineEntry, SetFormat } from "../types.js";
import {
  EMPTY_MESSAGE,
  currentStops,
  formatSpeed,
  formatSet,
  isDotRun,
  slackAxisTimes,
  snapTargets,
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

export interface CurrentScrubberProps extends Pick<
  ScrubberProps,
  "onSelect" | "moveTo" | "onNow" | "bounded"
> {
  timeline: CurrentTimelineEntry[];
  events: CurrentEvent[];
  timezone: string;
  latitude: number;
  longitude: number;
  directions?: Directions;
  setFormat?: SetFormat;
  /** Major-axis speed threshold for axis windows, in knots. */
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
  { id, g, bounded, now, past, pastMask, shade, eventTimes, dayChrome }: StripKit,
  timeline: CurrentTimelineEntry[],
  events: CurrentEvent[],
  runs: SlackWindow[],
  y: (v: number) => number,
  locale?: string,
) {
  const height = G.height + (events.some((e) => e.kind !== "slack") ? 20 : 0);
  const curve = timeline
    .map((p, i) => `${i ? "L" : "M"}${g.x(p.time.getTime()).toFixed(1)} ${y(p.speed).toFixed(1)}`)
    .join("");
  // Window edges use the curve's interpolation so their strokes join it.
  const run = (w: SlackWindow) => {
    const a = w.start.getTime();
    const b = w.end.getTime();
    const times = [a, ...timeline.map((p) => p.time.getTime()).filter((t) => t > a && t < b), b];
    return times
      .map(
        (t, i) =>
          `${i ? "L" : "M"}${g.x(t).toFixed(1)} ${y(speedAt(timeline, new Date(t))!).toFixed(1)}`,
      )
      .join("");
  };
  const area = `${curve}L${g.width} ${ZERO_Y}L0 ${ZERO_Y}Z`;
  const step = Math.max(1, Math.floor(timeline.length / 600));
  const threadStops = timeline.filter((_, i) => i % step === 0);

  const strokes = runs.filter((w) => !isDotRun(w));
  // Runs draw to the edges; only marks and labels keep clear of them.
  const zeros = events.filter(
    (e) => e.kind === "slack" && e.time.getTime() >= g.start && e.time.getTime() <= g.end,
  );
  const cores = zeros.map((e) => ({
    start: new Date(Math.max(g.start, e.time.getTime() - 600_000)),
    end: new Date(Math.min(g.end, e.time.getTime() + 600_000)),
  }));
  const maxima = awayFromEdges(
    events.filter((e) => e.kind !== "slack").map((e) => ({ ...e, time: e.time.getTime() })),
    g.start,
    g.end,
    bounded,
  );
  const axisTimes = slackAxisTimes(
    strokes,
    zeros.map((e) => e.time.getTime()),
  );
  const times = thinLabels(
    awayFromEdges(
      axisTimes.sort((a, b) => a - b).map((time) => ({ time })),
      g.start,
      g.end,
      bounded,
    ),
  ).map((l) => l.time);

  const nowSpeed = now >= g.start && now <= g.end ? speedAt(timeline, new Date(now)) : undefined;

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
          <rect width={g.width} height={height} fill="#fff" />
          {[...strokes, ...cores].map((w, i) => (
            <g key={`${i}:${w.start.getTime()}`}>
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
          <rect width={g.width} height={height} fill="#fff" />
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
            <path d={curve} stroke={speedColor(0)} strokeWidth={2.5} />
            <path d={curve} stroke={`url(#${id}thread)`} strokeWidth={2} />
          </g>
          {strokes.map((w) => (
            <path key={w.start.getTime()} d={run(w)} stroke={C.line} strokeWidth={SLACK_WIDTH} />
          ))}
        </g>
      </g>

      {eventTimes(times, { fill: C.go, fontSize: 14, fontWeight: 400, opacity: 1 })}
      {eventTimes(
        thinLabels(maxima).map((e) => e.time),
        {
          fill: C.foam,
          fontSize: 12,
          fontWeight: 500,
          y: G.eventTimeY + 20,
        },
      )}

      <g mask={pastMask} fill="none" strokeLinecap="round">
        {cores.map((w, i) => (
          <path key={zeros[i].time.getTime()} d={run(w)} stroke={C.go} strokeWidth={SLACK_WIDTH} />
        ))}
      </g>

      {maxima.map((e) => {
        // Hang into the turn: below a local high, above a local low.
        const toward = e.kind === "maxFlood" || e.kind === "minEbb" ? 1 : -1;
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
  setFormat,
  threshold = DEFAULT_SLACK_THRESHOLD,
  locale,
  now,
  className,
  bounded,
  onSelect,
  moveTo,
  onNow,
}: CurrentScrubberProps) {
  const resolvedSetFormat = useSetFormat(setFormat);
  const flood = directions?.flood;
  const ebb = directions?.ebb;
  const track = useMemo((): Track => {
    const runs = slackRuns(timeline, events, threshold);
    const y = speedY(timeline);
    const g = geometry(timeline[0].time.getTime(), timeline[timeline.length - 1].time.getTime());
    const read = (t: number) => readCurrent(new Date(t), timeline, events, { flood, ebb });
    return {
      label: "Current timeline",
      hasMaxTimes: events.some((e) => e.kind !== "slack"),
      start: g.start,
      end: g.end,
      y: (t) => y(speedAt(timeline, new Date(t)) ?? 0),
      dot: { size: 10, glow: 3 },
      stops: currentStops(timeline, events, runs),
      targets: (stops, first, last) => snapTargets(stops, events, runs, first, last),
      lead: (t) => {
        const reading = read(t);
        if (!reading) return undefined;
        return {
          spoken: spokenReading(reading, t, timezone, locale, resolvedSetFormat),
          content: (
            <>
              <div
                className="flex items-center gap-1.5 text-[13px] font-semibold"
                aria-hidden="true"
              >
                <span className="flex items-center gap-1 font-medium opacity-85">
                  {reading.direction !== undefined ? (
                    <>
                      <SetArrow direction={reading.direction} size={13} />
                      Set {formatSet(reading.direction, resolvedSetFormat)}
                    </>
                  ) : (
                    "Set —"
                  )}
                </span>
              </div>
              <div
                className="flex items-baseline gap-1 tabular-nums"
                style={{ fontFamily: "var(--sw-font-rounded, ui-rounded, system-ui, sans-serif)" }}
                aria-hidden="true"
              >
                <span className="text-[44px] leading-none font-medium">
                  {formatSpeed(reading.magnitude, locale)}
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
  }, [timeline, events, threshold, flood, ebb, timezone, locale, resolvedSetFormat]);

  return (
    <Scrubber
      track={track}
      bounded={bounded}
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
