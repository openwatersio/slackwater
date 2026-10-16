import { useEffect, useId, useMemo, useRef, useState } from "react";
import { interpolateLevel, useCurrentLevel } from "../hooks/use-current-level.js";
import { useTimeline } from "../hooks/use-timeline.js";
import { useExtremes } from "../hooks/use-extremes.js";
import { useSlackwaterConfig } from "../provider.js";
import { formatLevel } from "../utils/format.js";
import type { Extreme, TimelineEntry, Units } from "../types.js";
import { HALF_TIDE_CYCLE_MS } from "../constants.js";

interface TideConditionsDataProps {
  timeline: TimelineEntry[];
  extremes: Extreme[];
  units: Units;
  timezone: string;
}

interface TideConditionsFetchProps {
  id: string;
}

export type TideConditionsProps = (TideConditionsDataProps | TideConditionsFetchProps) & {
  showDate?: boolean;
  /** Fill the parent's height instead of using the default minimum height */
  fill?: boolean;
  className?: string;
};

const NEAR_EXTREME_MS = 10 * 60 * 1000;

function getNearestExtremes(extremes: Extreme[]): {
  current: Extreme | null;
  next: Extreme | null;
} {
  const now = Date.now();
  const nextIdx = extremes.findIndex((e) => e.time.getTime() > now);
  if (nextIdx === -1) return { current: null, next: null };

  const next = extremes[nextIdx];
  // If we're within 10 minutes of the next extreme, treat it as "now"
  if (next.time.getTime() - now <= NEAR_EXTREME_MS) {
    return { current: next, next: extremes[nextIdx + 1] ?? null };
  }

  // Also check the previous extreme
  if (nextIdx > 0) {
    const prev = extremes[nextIdx - 1];
    if (now - prev.time.getTime() <= NEAR_EXTREME_MS) {
      return { current: prev, next };
    }
  }

  return { current: null, next };
}

type TideState = "rising" | "falling" | "high" | "low";

const STATE_ICON: Record<TideState, { icon: string; label: string; color: string }> = {
  rising: { icon: "↗", label: "Rising", color: "text-(--sw-graph-high)" },
  falling: { icon: "↘", label: "Falling", color: "text-(--sw-graph-low)" },
  high: { icon: "⤒", label: "High tide", color: "text-(--sw-graph-high)" },
  low: { icon: "⤓", label: "Low tide", color: "text-(--sw-graph-low)" },
};

export function WaterLevelAtTime({
  label,
  level,
  time,
  units,
  locale,
  timezone,
  state,
  variant,
}: {
  label: string;
  level: number;
  time: Date;
  units: Units;
  locale: string;
  timezone?: string;
  state?: TideState;
  variant?: "left" | "right";
}) {
  const stateIcon = state ? STATE_ICON[state] : null;
  return (
    <div className={`flex flex-col${variant === "right" ? " items-end text-right" : ""}`}>
      <div
        className={`flex items-baseline gap-1 text-(--sw-foam)/55 text-[11px] uppercase tracking-wide${variant === "right" ? " flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        {stateIcon && (
          <span
            role="img"
            className={`text-lg font-semibold ${stateIcon.color}`}
            aria-label={stateIcon.label}
          >
            {stateIcon.icon}
          </span>
        )}
      </div>
      <span
        className={`flex items-baseline gap-1 text-xl @md:text-2xl text-nowrap font-semibold tabular-nums text-white${variant === "right" ? " flex-row-reverse" : ""}`}
      >
        {formatLevel(level, units)}
      </span>
      <span className="text-sm tabular-nums text-(--sw-foam)/55">
        {time.toLocaleString(locale, {
          timeStyle: "short",
          timeZone: timezone,
        })}
      </span>
    </div>
  );
}

/** A tide cycle either side of now, faint behind the readings. */
function CycleCurve({ timeline, extremes }: { timeline: TimelineEntry[]; extremes: Extreme[] }) {
  const id = useId().replace(/\W/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);

  const from = now - HALF_TIDE_CYCLE_MS;
  const to = now + HALF_TIDE_CYCLE_MS;
  const points = timeline.filter((p) => p.time.getTime() >= from && p.time.getTime() <= to);
  const { width, height } = size;
  const levels = points.map((p) => p.level);
  const lo = Math.min(0, ...levels);
  const hi = Math.max(...levels);
  const pad = (hi - lo) * 0.2 || 0.5;
  const x = (t: number) => ((t - from) / (to - from)) * width;
  const y = (level: number) => height - ((level - lo + pad) / (hi - lo + 2 * pad)) * height;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.time.getTime()).toFixed(1)} ${y(p.level).toFixed(1)}`)
    .join("");
  const current = interpolateLevel(points, now);

  return (
    <div ref={ref} className="absolute inset-0">
      {width > 0 && points.length > 1 && (
        <svg width={width} height={height} aria-label="Tide cycle graph">
          <defs>
            <linearGradient id={`${id}fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--sw-graph-line)" stopOpacity={0.5} />
              <stop offset="1" stopColor="var(--sw-graph-line)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <path
            d={`${line}L${x(points[points.length - 1].time.getTime())} ${height}L${x(points[0].time.getTime())} ${height}Z`}
            fill={`url(#${id}fill)`}
            opacity={0.3}
          />
          <path
            d={line}
            fill="none"
            stroke="var(--sw-graph-line)"
            strokeWidth={2}
            strokeOpacity={0.5}
          />
          {extremes
            .filter((e) => e.time.getTime() >= from && e.time.getTime() <= to)
            .map((e) => (
              <circle
                key={e.time.getTime()}
                cx={x(e.time.getTime())}
                cy={y(e.level)}
                r={3}
                fill={e.high ? "var(--sw-graph-high)" : "var(--sw-graph-low)"}
              />
            ))}
          {current && (
            <line
              x1={x(now)}
              x2={x(now)}
              y1={0}
              y2={height}
              stroke="var(--sw-paper)"
              strokeOpacity={0.4}
            />
          )}
        </svg>
      )}
    </div>
  );
}

function TideConditionsStatic({
  timeline,
  extremes,
  units,
  timezone,
  showDate,
  fill,
  className,
}: TideConditionsDataProps & { showDate: boolean; fill?: boolean; className?: string }) {
  const { locale } = useSlackwaterConfig();
  const currentLevel = useCurrentLevel(timeline);
  const { current: nearExtreme, next: nextExtreme } = getNearestExtremes(extremes);

  if (!currentLevel) {
    return (
      <div className={`text-white ${className ?? ""}`}>
        <h2 className="text-lg">No tide data available</h2>
      </div>
    );
  }

  const dateLabel = currentLevel.time.toLocaleString(locale, {
    dateStyle: "medium",
    timeZone: timezone,
  });

  return (
    <div className={`@container text-white ${fill ? "h-full" : ""} ${className ?? ""}`}>
      <div className={`sw-card relative ${fill ? "h-full" : "min-h-60"} overflow-hidden`}>
        <CycleCurve timeline={timeline} extremes={extremes} />
        {showDate && (
          <div className="hidden @sm:block absolute top-0 left-0 m-4">
            <h2 className="text-lg font-semibold">{dateLabel}</h2>
          </div>
        )}
        <div
          className={`flex flex-col justify-center items-center ${fill ? "h-full" : "min-h-60"} p-4 @sm:p-8 gap-1 pointer-events-none`}
        >
          {/* At small sizes the date flows centered above the levels instead
              of overlaying the top-left corner */}
          {showDate && <h2 className="@sm:hidden text-sm font-semibold">{dateLabel}</h2>}
          <div className="flex justify-center items-center w-full gap-4 @sm:gap-8 *:flex-1">
            <WaterLevelAtTime
              {...(nearExtreme ?? currentLevel)}
              label="Now"
              units={units}
              locale={locale}
              timezone={timezone}
              state={
                nearExtreme
                  ? nearExtreme.high
                    ? "high"
                    : "low"
                  : nextExtreme
                    ? nextExtreme.high
                      ? "rising"
                      : "falling"
                    : undefined
              }
              variant="right"
            />

            {nextExtreme ? (
              <WaterLevelAtTime
                label="Next"
                level={nextExtreme.level}
                time={nextExtreme.time}
                units={units}
                locale={locale}
                timezone={timezone}
                state={nextExtreme.high ? "high" : "low"}
              />
            ) : (
              <div></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TideConditionsFetcher({
  id,
  showDate,
  fill,
  className,
}: TideConditionsFetchProps & { showDate: boolean; fill?: boolean; className?: string }) {
  const config = useSlackwaterConfig();
  const [start, end] = useMemo(() => {
    const now = Date.now();
    return [
      new Date(now - HALF_TIDE_CYCLE_MS).toISOString(),
      new Date(now + HALF_TIDE_CYCLE_MS).toISOString(),
    ];
  }, []);

  const timeline = useTimeline({ id, start, end });
  const extremes = useExtremes({ id, start, end });

  if (timeline.isLoading || extremes.isLoading) {
    return (
      <div className={`text-white ${fill ? "h-full" : ""} ${className ?? ""}`}>
        <div
          className={`sw-card ${fill ? "h-full" : "min-h-60"} flex items-center justify-center text-sm text-(--sw-foam)/62`}
        >
          Loading...
        </div>
      </div>
    );
  }

  const error = timeline.error ?? extremes.error;
  if (error) {
    return (
      <div className={`text-white ${fill ? "h-full" : ""} ${className ?? ""}`}>
        <div
          className={`sw-card ${fill ? "h-full" : "min-h-60"} flex items-center justify-center p-4 text-center text-sm text-(--sw-attention)`}
        >
          {error.message}
        </div>
      </div>
    );
  }

  if (!timeline.data || !extremes.data) return null;

  return (
    <TideConditionsStatic
      timeline={timeline.data.timeline}
      extremes={extremes.data.extremes}
      units={timeline.data.units ?? config.units}
      timezone={config.timezone ?? extremes.data.station?.timezone ?? "UTC"}
      showDate={showDate}
      fill={fill}
      className={className}
    />
  );
}

export function TideConditions({
  showDate = true,
  fill,
  className,
  ...props
}: TideConditionsProps) {
  if ("id" in props) {
    return (
      <TideConditionsFetcher id={props.id} showDate={showDate} fill={fill} className={className} />
    );
  }
  return <TideConditionsStatic {...props} showDate={showDate} fill={fill} className={className} />;
}
