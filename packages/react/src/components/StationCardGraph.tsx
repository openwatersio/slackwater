import { useId, useLayoutEffect, useEffect, useRef, useState, type ReactNode } from "react";

import type {
  CurrentEvent,
  CurrentTimelineEntry,
  Extreme,
  TimelineEntry,
  Units,
} from "../types.js";
import {
  CARD_BACK_MS,
  CARD_FORWARD_MS,
  cardDomain,
  hangToward,
  thinAxisTimes,
  valueAt,
} from "../utils/card.js";
import { formatSpeed, speedColor, threadOpacity, type SlackWindow } from "../utils/current.js";
import { formatHeight, heightUnit, rateColor, tideRates } from "../utils/tide.js";
import { chartTime } from "../utils/time.js";
import { C, GLYPH, HALO_GAP, SET_ARROW_PATH, toBarPath } from "./Scrubber.js";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const HOUR = 3_600_000;
const PAST_LINE = 0.35;
const PAST_LABEL = 0.45;
const DOT_RADIUS = 2.5;
const NOW_RADIUS = 3.5;
const RUN_WIDTH = 3.5;
/** A lane under the curve for the axis times. */
const TIME_LANE = 6;
const TIME_BASELINE = 10;
/** An extreme this close to an edge keeps its dot and time but drops its reading. */
const LABEL_MARGIN = 34;

export type CardGraphData =
  | { kind: "tide"; timeline: TimelineEntry[]; extremes: Extreme[]; units: Units }
  | {
      kind: "current";
      timeline: CurrentTimelineEntry[];
      events: CurrentEvent[];
      /** The slack windows, from the shared rule; a windowless slack is a zero-width run. */
      runs: SlackWindow[];
    };

export interface StationCardGraphProps {
  data: CardGraphData;
  now: number;
  /** The span either side of now; the card's by default. */
  back?: number;
  forward?: number;
  timezone: string;
  locale?: string;
}

interface Mark {
  time: number;
  value: number;
  high: boolean;
  valueText: string;
  spokenText: string;
  /** A current peak's set; a tide turn has none. */
  direction?: number;
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useIsomorphicLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const pathOf = (points: { x: number; y: number }[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");

/**
 * The curve behind a station card, after the app's card graph: one and a
 * half swings back and two and a half ahead, fitted to the water in view,
 * with each turn's dot, reading, and time.
 */
export function StationCardGraph({
  data,
  now,
  back = CARD_BACK_MS,
  forward = CARD_FORWARD_MS,
  timezone,
  locale,
}: StationCardGraphProps) {
  const [ref, { width, height }] = useSize();
  const id = useId().replace(/\W/g, "");
  const from = now - back;
  const to = now + forward;
  const tide = data.kind === "tide";
  const points = tide
    ? data.timeline.map((p) => ({ time: p.time.getTime(), value: p.level }))
    : data.timeline.map((p) => ({ time: p.time.getTime(), value: p.speed }));
  const marks: Mark[] = tide
    ? data.extremes.map((e) => ({
        time: e.time.getTime(),
        value: e.level,
        high: e.high,
        valueText: formatHeight(e.level, data.units, locale),
        spokenText: `${formatHeight(e.level, data.units, locale)} ${heightUnit(data.units)}`,
      }))
    : data.events
        .filter((e) => e.kind !== "slack")
        .map((e) => ({
          time: e.time.getTime(),
          value: e.speed,
          high: e.kind === "maxFlood",
          valueText: formatSpeed(e.speed, locale),
          spokenText: `${formatSpeed(e.speed, locale)} kn`,
          ...(e.direction !== undefined && { direction: e.direction }),
        }));
  const spoken = marks
    .filter((m) => m.time >= from && m.time <= to)
    .map((m) => `${m.spokenText} at ${chartTime(m.time, timezone, locale)}`)
    .join(", ");
  const label = `${Math.round((back + forward) / HOUR)}-hour curve`;

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      role="img"
      aria-label={spoken ? `${label}: ${spoken}` : label}
    >
      {width > 0 && height > 0 && points.length > 1 && (
        <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
          {drawGraph({ id, data, points, marks, width, height, now, from, to, timezone, locale })}
        </svg>
      )}
    </div>
  );
}

function drawGraph({
  id,
  data,
  points,
  marks,
  width,
  height,
  now,
  from,
  to,
  timezone,
  locale,
}: {
  id: string;
  data: CardGraphData;
  points: { time: number; value: number }[];
  marks: Mark[];
  width: number;
  height: number;
  now: number;
  from: number;
  to: number;
  timezone: string;
  locale?: string;
}): ReactNode {
  const tide = data.kind === "tide";
  const { lo, hi, lowest } = cardDomain(points, from, to, !tide);
  const plotHeight = Math.max(0, height - TIME_LANE);
  const scale = width / (to - from);
  const x = (t: number) => (t - from) * scale;
  const y = (v: number) => plotHeight * (1 - (v - lo) / (hi - lo));
  const at = (t: number) => ({ x: x(t), y: y(valueAt(points, t)) });
  const nowX = x(now);
  const zeroY = y(0);
  const line = pathOf(points.map((p) => ({ x: x(p.time), y: y(p.value) })));
  const area = `${line}L${x(points[points.length - 1].time)} ${zeroY}L${x(points[0].time)} ${zeroY}Z`;
  const fade = (t: number) => (t < now ? PAST_LABEL : 1);
  const inside = (px: number, margin: number) => px >= margin && px <= width - margin;
  const offset = (t: number) => Math.min(1, Math.max(0, x(t) / width));

  const runs = tide ? [] : data.runs;
  // A run narrower than a dot reads as a blot, so it draws as the dot at its center.
  const isDot = (w: SlackWindow) => (w.end.getTime() - w.start.getTime()) * scale < DOT_RADIUS * 2;
  const center = (w: SlackWindow) => (w.start.getTime() + w.end.getTime()) / 2;
  const axisTimes = new Set(
    thinAxisTimes(
      tide ? marks.map((m) => m.time) : runs.map((w) => (isDot(w) ? center(w) : w.start.getTime())),
      x,
      width,
    ),
  );
  const strokes = runs
    .filter((w) => !isDot(w))
    .map((w) => {
      const a = w.start.getTime();
      const b = w.end.getTime();
      const times = [a, ...points.map((p) => p.time).filter((t) => t > a && t < b), b];
      return { key: a, d: pathOf(times.map(at)) };
    });
  const slackDots = runs.filter(isDot).map((w) => ({ time: center(w), ...at(center(w)) }));
  const nowDot = at(now);
  const turns = tide ? marks : [];

  let fill: ReactNode;
  if (tide) {
    // Blue fading to clear at chart datum, amber fading in below it; clear at the lowest trough when the water never reaches datum.
    const lowestY = y(lowest);
    const reaches = lowestY >= zeroY;
    const fadeY = reaches ? zeroY : lowestY;
    const top = Math.min(0, fadeY);
    const bottom = Math.max(height, fadeY);
    const stop = (fadeY - top) / (bottom - top);
    fill = (
      <>
        <linearGradient
          id={`${id}fill`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={top}
          y2={bottom}
        >
          <stop offset={0} stopColor={C.line} stopOpacity={0.5} />
          <stop offset={stop} stopColor={C.line} stopOpacity={0} />
          <stop offset={stop} stopColor={C.low} stopOpacity={0} />
          <stop offset={1} stopColor={reaches ? C.low : C.line} stopOpacity={reaches ? 0.5 : 0} />
        </linearGradient>
        <clipPath id={`${id}plot`}>
          <rect width={width} height={height} />
        </clipPath>
      </>
    );
  } else {
    // Beneath the curve only: the flood lobes, blue at their peaks and clear at slack.
    const half = Math.max(zeroY, plotHeight - zeroY);
    fill = (
      <>
        <linearGradient
          id={`${id}fill`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={zeroY - half}
          y2={zeroY}
        >
          <stop offset={0} stopColor={C.line} stopOpacity={0.5} />
          <stop offset={1} stopColor={C.line} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${id}plot`}>
          <rect width={width} height={Math.max(0, zeroY)} />
        </clipPath>
      </>
    );
  }

  const rates = data.kind === "tide" ? tideRates(data.timeline, data.units) : [];

  return (
    <>
      <defs>
        {fill}
        <mask id={`${id}past`} maskUnits="userSpaceOnUse">
          <rect width={Math.max(0, nowX)} height={height} fill="#fff" fillOpacity={PAST_LINE} />
          <rect x={nowX} width={Math.max(0, width - nowX)} height={height} fill="#fff" />
        </mask>
        <mask id={`${id}halo`} maskUnits="userSpaceOnUse">
          <rect width={width} height={height} fill="#fff" />
          {turns.map((m) => (
            <circle
              key={m.time}
              cx={x(m.time)}
              cy={y(m.value)}
              r={DOT_RADIUS + HALO_GAP}
              fill="#000"
            />
          ))}
          {slackDots.map((d) => (
            <circle key={d.time} cx={d.x} cy={d.y} r={DOT_RADIUS + HALO_GAP} fill="#000" />
          ))}
          <circle cx={nowDot.x} cy={nowDot.y} r={NOW_RADIUS + HALO_GAP} fill="#000" />
        </mask>
        {tide ? (
          <linearGradient id={`${id}line`} gradientUnits="userSpaceOnUse" x1="0" x2={width}>
            {rates.map((p) => (
              <stop
                key={p.time.getTime()}
                offset={offset(p.time.getTime())}
                stopColor={rateColor(p.rate) ?? C.line}
              />
            ))}
          </linearGradient>
        ) : (
          <>
            <linearGradient id={`${id}thread`} gradientUnits="userSpaceOnUse" x1="0" x2={width}>
              {points.map((p) => (
                <stop
                  key={p.time}
                  offset={offset(p.time)}
                  stopColor={speedColor(p.value)}
                  stopOpacity={threadOpacity(p.value)}
                />
              ))}
            </linearGradient>
            {/* The line leaves room for each run's body and a halo around its round caps. */}
            <mask id={`${id}track`} maskUnits="userSpaceOnUse" fill="none">
              <rect width={width} height={height} fill="#fff" />
              {strokes.map((s) => (
                <g key={s.key}>
                  <path
                    d={s.d}
                    stroke="#000"
                    strokeWidth={RUN_WIDTH + 2 * HALO_GAP}
                    strokeLinecap="round"
                  />
                  <path
                    d={s.d}
                    stroke="#fff"
                    strokeWidth={RUN_WIDTH + 2 * HALO_GAP}
                    strokeLinecap="butt"
                  />
                  <path d={s.d} stroke="#000" strokeWidth={RUN_WIDTH} strokeLinecap="butt" />
                </g>
              ))}
            </mask>
          </>
        )}
      </defs>

      <g mask={`url(#${id}halo)`}>
        <path d={area} fill={`url(#${id}fill)`} clipPath={`url(#${id}plot)`} />
        {(!tide || (lo < 0 && 0 < hi)) && (
          <line
            x1={0}
            x2={width}
            y1={zeroY}
            y2={zeroY}
            stroke={C.foam}
            strokeOpacity={0.35}
            strokeDasharray="1 3"
          />
        )}
        <g mask={`url(#${id}past)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {tide ? (
            <path d={line} stroke={`url(#${id}line)`} strokeWidth={2.5} />
          ) : (
            <>
              <g mask={`url(#${id}track)`}>
                <path d={line} stroke={C.line} strokeWidth={2.5} />
                <path d={line} stroke={`url(#${id}thread)`} strokeWidth={2} />
              </g>
              {strokes.map((s) => (
                <path key={s.key} d={s.d} stroke={C.go} strokeWidth={RUN_WIDTH} />
              ))}
            </>
          )}
        </g>
      </g>

      {marks.map((m) => {
        const mx = x(m.time);
        const my = y(m.value);
        const tint = m.high ? C.high : C.low;
        const toward = hangToward(my, m.high, plotHeight);
        const cy = my + toward * 23;
        return (
          <g key={m.time} opacity={fade(m.time)}>
            {tide && <circle cx={mx} cy={my} r={DOT_RADIUS} fill={tint} />}
            {tide && axisTimes.has(m.time) && (
              <AxisTime x={mx} height={height} time={m.time} timezone={timezone} locale={locale} />
            )}
            {inside(mx, LABEL_MARGIN) && (
              <>
                <text
                  x={mx}
                  y={cy + toward * 7}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={C.foam}
                  fontSize={14}
                  fontWeight={600}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {m.valueText}
                </text>
                {tide ? (
                  <path
                    {...GLYPH}
                    transform={`translate(${mx - 6} ${cy - toward * 8 - 6})`}
                    d={toBarPath(m.high)}
                    stroke={tint}
                    strokeWidth={1.8}
                  />
                ) : (
                  m.direction !== undefined && (
                    <path
                      {...GLYPH}
                      transform={`translate(${mx} ${cy - toward * 8}) rotate(${m.direction})`}
                      d={SET_ARROW_PATH}
                      stroke={C.foam}
                      strokeWidth={2}
                    />
                  )
                )}
              </>
            )}
          </g>
        );
      })}

      {!tide &&
        runs
          .map((w) => (isDot(w) ? center(w) : w.start.getTime()))
          .filter((t) => axisTimes.has(t))
          .map((t) => (
            <g key={t} opacity={fade(t)}>
              <AxisTime x={x(t)} height={height} time={t} timezone={timezone} locale={locale} />
            </g>
          ))}

      {slackDots.map((d) => (
        <circle key={d.time} cx={d.x} cy={d.y} r={DOT_RADIUS} fill={C.go} opacity={fade(d.time)} />
      ))}

      <circle cx={nowDot.x} cy={nowDot.y} r={NOW_RADIUS} fill={C.paper} />
    </>
  );
}

function AxisTime({
  x,
  height,
  time,
  timezone,
  locale,
}: {
  x: number;
  height: number;
  time: number;
  timezone: string;
  locale?: string;
}) {
  return (
    <text
      x={x}
      y={height - TIME_BASELINE}
      textAnchor="middle"
      dominantBaseline="central"
      fill={C.foam}
      fontSize={10}
      fontWeight={500}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {chartTime(time, timezone, locale)}
    </text>
  );
}
