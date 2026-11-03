import { useEffect, useState, type ReactNode } from "react";

import { useSlackwaterConfig } from "../provider.js";
import type { Units } from "../types.js";
import { formatNm, type CurrentCardReading, type TideCardReading } from "../utils/card.js";
import { compass16, formatSpeed } from "../utils/current.js";
import { formatHeight, heightUnit } from "../utils/tide.js";
import { C, SET_ARROW_PATH, TideGlyph } from "./Scrubber.js";

const SPOKEN_UNIT: Record<Units, string> = { feet: "feet", meters: "metres" };

/** The clock to the minute, or `fixed` when the caller pins it. */
export function useMinuteClock(fixed?: number): number {
  const [ticked, setTicked] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const timer = setInterval(() => setTicked(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [fixed]);
  return fixed ?? ticked;
}

export interface StationCardFaceProps {
  name: string;
  region: string;
  distance?: number;
  reading?: ReactNode;
  graph?: ReactNode;
  /** The skeleton curve, while the predictions load. */
  loading?: boolean;
  /** A line under the identity when there is nothing to read. */
  status?: string;
  /** Quieter than a station with numbers. */
  quiet?: boolean;
}

/** The one card shell: identity left, reading right, the curve behind the lower band. */
export function StationCardFace({
  name,
  region,
  distance,
  reading,
  graph,
  loading,
  status,
  quiet,
}: StationCardFaceProps) {
  const { locale } = useSlackwaterConfig();
  const tall = !!graph || loading;
  return (
    <span
      className="relative flex flex-col overflow-hidden rounded-(--sw-radius-card) px-5 py-4 text-white"
      style={{
        minHeight: tall ? 168 : 96,
        background: "var(--sw-card-fill)",
        boxShadow: "var(--sw-shadow-card)",
        fontFamily: "var(--sw-font-sans)",
      }}
    >
      <span className="relative z-[1] flex items-start gap-8" style={{ opacity: quiet ? 0.82 : 1 }}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xl leading-[25px] font-semibold">{name}</span>
          <span className="text-xs text-(--sw-foam)">
            {region}
            {distance !== undefined && (
              <span className="whitespace-nowrap">
                <span className="text-(--sw-foam)/70"> • </span>
                <span className="tabular-nums">{formatNm(distance, locale)}</span>
              </span>
            )}
          </span>
        </span>
        {reading && <span className="flex shrink-0 flex-col items-end gap-0.5">{reading}</span>}
      </span>
      {status && (
        <span className="relative z-[1] mt-2.5 text-xs text-(--sw-foam)/62">{status}</span>
      )}
      {(graph || loading) && (
        // Behind the identity, and 3 px past each side so the line leaves through the edge on its own slope.
        <span className="absolute -inset-x-[3px] top-[54px] bottom-0">{graph ?? <Skeleton />}</span>
      )}
    </span>
  );
}

/** A data-free echo of the curve and its time axis. */
function Skeleton() {
  const d = Array.from(
    { length: 101 },
    (_, x) => `${x ? "L" : "M"}${x} ${(46 - 26 * Math.sin((x / 100) * 4 * Math.PI)).toFixed(2)}`,
  ).join("");
  return (
    <>
      <span className="sr-only">Loading</span>
      <span className="absolute inset-0" aria-hidden="true">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0"
        >
          <path
            d={d}
            fill="none"
            stroke={C.foam}
            strokeOpacity={0.2}
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {[22, 50, 78].map((left) => (
          <span
            key={left}
            className="absolute bottom-[7px] h-1.5 w-[34px] -translate-x-1/2 rounded-full bg-(--sw-foam)/20"
            style={{ left: `${left}%` }}
          />
        ))}
      </span>
    </>
  );
}

/** The height and its unit, the one size the cards and the widget print it at. */
function Height({ level, units, locale }: { level: number; units: Units; locale?: string }) {
  return (
    <span className="whitespace-nowrap text-white" aria-hidden="true">
      <span className="text-xl leading-[25px] font-bold tabular-nums">
        {formatHeight(level, units, locale)}
      </span>
      <span className="text-[17px]"> {heightUnit(units)}</span>
    </span>
  );
}

export function spokenTideCard(reading: TideCardReading, units: Units, locale?: string): string {
  const value = formatHeight(reading.level, units, locale);
  return `${value} ${SPOKEN_UNIT[units]}, ${reading.rising ? "rising" : "falling"}`;
}

/** The tide's reading: height, then the state and its arrow. `compact` is the widget's one row. */
export function TideReading({
  reading,
  units,
  locale,
  compact,
}: {
  reading: TideCardReading;
  units: Units;
  locale?: string;
  compact?: boolean;
}) {
  // Rising wears the chart's high teal, not the flood blue: direction color belongs to currents.
  const arrow = (
    <span className="inline-flex" style={{ color: reading.rising ? C.high : C.low }}>
      <TideGlyph state={reading.rising ? "Rising" : "Falling"} size={12} />
    </span>
  );
  return (
    <>
      <span className="sr-only">{spokenTideCard(reading, units, locale)}</span>
      {compact ? (
        <span className="flex items-center gap-1 whitespace-nowrap" aria-hidden="true">
          <Height level={reading.level} units={units} locale={locale} />
          {arrow}
        </span>
      ) : (
        <>
          <Height level={reading.level} units={units} locale={locale} />
          <span className="flex items-center gap-1" aria-hidden="true">
            <span className="text-xs text-(--sw-foam)/60">
              {reading.rising ? "Rising" : "Falling"}
            </span>
            {arrow}
          </span>
        </>
      )}
    </>
  );
}

export function spokenCurrentCard(reading: CurrentCardReading, locale?: string): string {
  const speed = `${formatSpeed(reading.speed, locale)} knots`;
  if (reading.slack) return `${speed}, slack`;
  const word = reading.speed >= 0 ? "flooding" : "ebbing";
  return reading.direction === undefined
    ? `${speed}, ${word}`
    : `${speed}, ${word}, setting ${compass16(reading.direction)}`;
}

/** The current's reading: speed, then the state and the set, which the arrow's color names. */
export function CurrentReading({
  reading,
  locale,
}: {
  reading: CurrentCardReading;
  locale?: string;
}) {
  const { speed, slack, direction } = reading;
  const tint = slack ? C.go : speed >= 0 ? C.flood : C.ebb;
  return (
    <>
      <span className="sr-only">{spokenCurrentCard(reading, locale)}</span>
      <span className="whitespace-nowrap text-white" aria-hidden="true">
        <span className="text-xl leading-[25px] font-bold tabular-nums">
          {formatSpeed(speed, locale)}
        </span>
        <span className="text-[17px]"> kn</span>
      </span>
      <span className="flex items-center gap-1 text-[11px]" aria-hidden="true">
        <span
          style={slack ? { color: C.go } : undefined}
          className={slack ? "" : "text-(--sw-foam)/60"}
        >
          {slack ? "Slack" : speed >= 0 ? "Flooding" : "Ebbing"}
        </span>
        {Math.abs(speed) < 0.05 ? (
          // Under 0.05 kn the set gives way to a mark of the same footprint, so the row never resizes.
          <span className="w-[30px] text-center text-(--sw-foam)/60">•</span>
        ) : (
          direction !== undefined && (
            <span className="flex items-center gap-1" style={{ color: tint }}>
              {compass16(direction)}
              <svg width={11} height={11} viewBox="-6 -6 12 12">
                <path
                  d={SET_ARROW_PATH}
                  transform={`rotate(${direction})`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )
        )}
      </span>
    </>
  );
}
