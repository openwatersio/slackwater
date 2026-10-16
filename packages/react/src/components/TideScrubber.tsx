import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import type { Extreme, TimelineEntry, Units } from "../types.js";
import { awayFromEdges, targetsWithin, thinLabels } from "../utils/scrubber.js";
import { leadTime } from "../utils/time.js";
import {
  EMPTY_TIDE_MESSAGE,
  eased,
  fastTideInk,
  fastTideText,
  fitScale,
  flowPeaks,
  formatHeight,
  governScale,
  heightUnit,
  lerpScale,
  levelAt,
  levelRange,
  rateAt,
  rateColor,
  readTide,
  spokenTide,
  tideRates,
  tideStops,
  type RatePoint,
  type TideScale,
  type TideState,
} from "../utils/tide.js";
import {
  C,
  EmptyStrip,
  G,
  HALO_GAP,
  Scrubber,
  geometry,
  nextStopComment,
  prefersReducedMotion,
  type ScrubberProps,
  type StripKit,
  type Track,
} from "./Scrubber.js";

const HOUR = 3_600_000;
const PLOT_DEPTH = G.plotBottom - G.plotTop;
const GLIDE_MS = 300;

export interface TideScrubberProps extends Pick<ScrubberProps, "onSelect" | "moveTo" | "onNow"> {
  timeline: TimelineEntry[];
  extremes: Extreme[];
  timezone: string;
  latitude: number;
  longitude: number;
  /** The units the timeline and extremes are in. */
  units: Units;
  /** BCP 47 locale for clocks and dates; defaults to the reader's. */
  locale?: string;
  /** The current instant; defaults to the clock. Pass it to render deterministically (prerendering). */
  now?: number;
  className?: string;
}

const GLYPH = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** SF Symbols `arrow.up.to.line` / `arrow.down.to.line`: arrives and stops. */
function toBarPath(high: boolean) {
  return high
    ? "M2 1.5h8M6 11V4.5M2.8 7.7 6 4.5l3.2 3.2"
    : "M2 10.5h8M6 1v6.5M2.8 4.3 6 7.5l3.2-3.2";
}

/** The lead's eyebrow glyph: to-bar at a turn, a diagonal on the way to one. */
function TideGlyph({ state }: { state: TideState }) {
  const d =
    state === "High" || state === "Low"
      ? toBarPath(state === "High")
      : state === "Rising"
        ? "M2.5 9.5 9.5 2.5M4.5 2.5h5v5"
        : "M2.5 2.5l7 7M9.5 4.5v5h-5";
  return (
    <svg width={13} height={13} viewBox="0 0 12 12" aria-hidden="true">
      <path {...GLYPH} strokeWidth={1.7} d={d} />
    </svg>
  );
}

/** The fit that opens the strip: the two days either side of now, as the app first builds them. */
function openingScale(timeline: TimelineEntry[], now: number): TideScale {
  const r =
    levelRange(timeline, now - 48 * HOUR, now + 48 * HOUR) ??
    levelRange(timeline, -Infinity, Infinity)!;
  return fitScale(r.min, r.max);
}

function drawTide(
  { g, now, past, pastMask, shade, eventTimes, dayChrome }: StripKit,
  id: string,
  lineGradient: ReactNode,
  timeline: TimelineEntry[],
  extremes: Extreme[],
  scale: TideScale,
  units: Units,
  locale?: string,
) {
  const y = (h: number) =>
    G.plotTop + (1 - (h - (scale.mid - scale.span)) / (2 * scale.span)) * PLOT_DEPTH;
  const curve = timeline
    .map((p, i) => `${i ? "L" : "M"}${g.x(p.time.getTime()).toFixed(1)} ${y(p.level).toFixed(1)}`)
    .join("");
  const datumY = y(0);
  const datumInSpan = 0 > scale.mid - scale.span && 0 < scale.mid + scale.span;
  const turns = awayFromEdges(
    extremes.map((e) => ({ ...e, time: e.time.getTime() })),
    g.start,
    g.end,
  );
  const times = thinLabels(turns.map((e) => ({ time: e.time }))).map((l) => l.time);
  const nowLevel = now >= g.start && now <= g.end ? levelAt(timeline, now) : undefined;

  return (
    <>
      <defs>
        {lineGradient}
        {/* Amber only where the water drops below chart datum, fading in away from the line. */}
        <linearGradient
          id={`${id}datum`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={datumY}
          y2={G.plotBottom}
        >
          <stop offset="0" stopColor={C.low} stopOpacity={0} />
          <stop offset="1" stopColor={C.low} stopOpacity={0.5} />
        </linearGradient>
        <clipPath id={`${id}plot`}>
          <rect y={G.plotTop} width={g.width} height={PLOT_DEPTH} />
        </clipPath>
        {/* Dots punch through everything drawn beneath them to the ground. */}
        <mask id={`${id}halo`} maskUnits="userSpaceOnUse">
          <rect width={g.width} height={G.height} fill="#fff" />
          {turns.map((e) => (
            <circle key={e.time} cx={g.x(e.time)} cy={y(e.level)} r={2.5 + HALO_GAP} fill="#000" />
          ))}
          {nowLevel !== undefined && (
            <circle cx={g.x(now)} cy={y(nowLevel)} r={3.5 + HALO_GAP} fill="#000" />
          )}
        </mask>
      </defs>

      <g mask={`url(#${id}halo)`}>
        {/* The water: opaque from the curve to the plot floor, whatever the page behind. */}
        <path d={`${curve}L${g.width} ${G.plotBottom}L0 ${G.plotBottom}Z`} fill={C.canvas} />
        {datumY < G.plotBottom && (
          <path
            data-fill="below-datum"
            d={`${curve}L${g.width} ${datumY}L0 ${datumY}Z`}
            fill={`url(#${id}datum)`}
            clipPath={`url(#${id}plot)`}
          />
        )}
        {shade(curve)}
        {datumInSpan && (
          <line
            x1={0}
            x2={g.width}
            y1={datumY}
            y2={datumY}
            stroke={C.foam}
            strokeOpacity={0.35}
            strokeDasharray="1 3"
          />
        )}
        <g mask={pastMask}>
          <path
            d={curve}
            fill="none"
            stroke={`url(#${id}line)`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>

      {turns.map((e) => {
        // Hangs toward the plot middle: the to-bar glyph nearest the turn, the height beyond it.
        const toward = e.high ? 1 : -1;
        const tint = e.high ? C.high : C.low;
        return (
          <g key={e.time} opacity={past(e.time)}>
            <circle cx={g.x(e.time)} cy={y(e.level)} r={2.5} fill={tint} />
            <g transform={`translate(${g.x(e.time)} ${y(e.level) + toward * 23})`}>
              <path
                {...GLYPH}
                transform={`translate(-6 ${-toward * 8 - 6})`}
                d={toBarPath(e.high)}
                stroke={tint}
                strokeWidth={1.8}
              />
              <text
                y={toward * 7}
                textAnchor="middle"
                dominantBaseline="central"
                fill={C.foam}
                fontSize={18}
                fontWeight={600}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatHeight(e.level, units, locale)}
              </text>
            </g>
          </g>
        );
      })}

      {eventTimes(times)}

      {nowLevel !== undefined && <circle cx={g.x(now)} cy={y(nowLevel)} r={3.5} fill={C.paper} />}

      {dayChrome}
    </>
  );
}

/**
 * A continuously scrolling tide strip under a fixed reading line, after the
 * app's tide detail: heights above chart datum, the curve colored by how fast
 * the water moves, and each high and low marked with its height and time.
 */
export function TideScrubber(props: TideScrubberProps) {
  // The strip scales time across its first and last samples, so it needs two.
  if (props.timeline.length < 2) {
    return <EmptyStrip message={EMPTY_TIDE_MESSAGE} className={props.className} />;
  }
  return <TideStrip {...props} />;
}

function TideStrip({
  timeline,
  extremes,
  timezone,
  latitude,
  longitude,
  units,
  locale,
  now,
  className,
  onSelect,
  moveTo,
  onNow,
}: TideScrubberProps) {
  const id = useId().replace(/\W/g, "");
  const rates = useMemo(() => tideRates(timeline, units), [timeline, units]);
  const peaks = useMemo(() => flowPeaks(rates), [rates]);

  // The drawn scale, and the governor's target it glides toward.
  const [scale, setScale] = useState(() => openingScale(timeline, now ?? Date.now()));
  const shown = useRef(scale);
  shown.current = scale;
  const held = useRef(scale);
  const glide = useRef<number | undefined>(undefined);
  useEffect(() => () => cancelAnimationFrame(glide.current!), []);

  const onView = useCallback(
    (t: number, span: number) => {
      const half = Math.max(span, 6 * HOUR) / 2 + HOUR;
      const r = levelRange(timeline, t - half, t + half);
      if (!r) return;
      const next = governScale(held.current, r.min, r.max);
      if (next === held.current) return;
      held.current = next;
      cancelAnimationFrame(glide.current!);
      if (prefersReducedMotion()) {
        setScale(next);
        return;
      }
      const from = shown.current;
      const began = performance.now();
      const frame = (time: number) => {
        const f = (time - began) / GLIDE_MS;
        setScale(lerpScale(from, next, eased(f)));
        glide.current = f < 1 ? requestAnimationFrame(frame) : undefined;
      };
      glide.current = requestAnimationFrame(frame);
    },
    [timeline],
  );

  // The rate colors depend on time alone, so a rescale doesn't rebuild a stop per sample.
  const lineGradient = useMemo(() => {
    const g = geometry(timeline[0].time.getTime(), timeline[timeline.length - 1].time.getTime());
    return (
      <linearGradient
        id={`${id}line`}
        gradientUnits="userSpaceOnUse"
        x1="0"
        x2={g.width}
        y1="0"
        y2="0"
      >
        {rates.map((p: RatePoint) => (
          <stop
            key={p.time.getTime()}
            offset={g.x(p.time.getTime()) / g.width}
            stopColor={rateColor(p.rate) ?? C.line}
          />
        ))}
      </linearGradient>
    );
  }, [id, timeline, rates]);

  const track = useMemo((): Track => {
    const start = timeline[0].time.getTime();
    const end = timeline[timeline.length - 1].time.getTime();
    const y = (h: number) =>
      G.plotTop + (1 - (h - (scale.mid - scale.span)) / (2 * scale.span)) * PLOT_DEPTH;
    const unit = heightUnit(units);
    return {
      label: "Tide timeline",
      start,
      end,
      y: (t) => y(levelAt(timeline, t) ?? scale.mid),
      dot: { size: 13, glow: 4 },
      stops: tideStops(extremes),
      targets: (stops, first, last) =>
        targetsWithin(
          [...stops.map((s) => s.time), ...peaks.map((p) => p.time.getTime())],
          first,
          last,
        ),
      lead: (t) => {
        const reading = readTide(t, timeline, rates, extremes);
        if (!reading) return undefined;
        return {
          spoken: spokenTide(reading, t, timezone, units, locale),
          content: (
            <>
              <div
                className="flex items-center gap-1.5 text-[13px] font-semibold"
                aria-hidden="true"
              >
                <span className="font-medium opacity-85">{reading.state}</span>
                <span
                  className="flex items-center"
                  style={{ color: fastTideInk(reading.rate) ?? (reading.up ? C.high : C.low) }}
                >
                  <TideGlyph state={reading.state} />
                </span>
              </div>
              <div
                className="flex items-baseline gap-1 tabular-nums"
                style={{ fontFamily: "var(--sw-font-rounded, ui-rounded, system-ui, sans-serif)" }}
                aria-hidden="true"
              >
                <span className="text-[44px] leading-none font-medium">
                  {formatHeight(reading.level, units, locale)}
                </span>
                <span className="text-[22px] font-light">{unit}</span>
              </div>
              <div className="text-xs tabular-nums whitespace-pre" aria-hidden="true">
                {leadTime(t, timezone, locale)}
              </div>
            </>
          ),
        };
      },
      comment: (t, stops) => {
        const plain = nextStopComment(t, stops, locale);
        const rate = rateAt(rates, t) ?? 0;
        const fast = fastTideText(rate, units, locale);
        if (!fast) return plain;
        // The tap goes to this run's fastest point, then on to the next stop from there.
        const peak = peaks
          .filter((p) => p.rate < 0 === rate < 0)
          .reduce<RatePoint | undefined>(
            (best, p) =>
              !best || Math.abs(p.time.getTime() - t) < Math.abs(best.time.getTime() - t)
                ? p
                : best,
            undefined,
          );
        const to =
          peak && Math.abs(peak.time.getTime() - t) > 1000 ? peak.time.getTime() : plain?.to;
        return { content: fast, spoken: fast, to, color: fastTideInk(rate) };
      },
      draw: (kit) => drawTide(kit, id, lineGradient, timeline, extremes, scale, units, locale),
    };
  }, [id, lineGradient, timeline, extremes, rates, peaks, scale, units, timezone, locale]);

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
      onView={onView}
    />
  );
}
