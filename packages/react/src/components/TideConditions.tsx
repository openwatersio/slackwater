import { useMemo, type ReactNode } from "react";
import { keepPreviousData } from "@tanstack/react-query";

import { useExtremes } from "../hooks/use-extremes.js";
import { useTimeline } from "../hooks/use-timeline.js";
import { useSlackwaterConfig } from "../provider.js";
import type { Extreme, TimelineEntry, Units } from "../types.js";
import { WIDGET_BACK_MS, WIDGET_FORWARD_MS, cardRange, readTideCard } from "../utils/card.js";
import { EMPTY_TIDE_MESSAGE } from "../utils/tide.js";
import { TideReading, useMinuteClock } from "./StationCardFace.js";
import { StationCardGraph } from "./StationCardGraph.js";

const HOUR = 3_600_000;

interface TideConditionsDataProps {
  timeline: TimelineEntry[];
  extremes: Extreme[];
  units: Units;
  timezone: string;
  /** The station's name, over the reading. */
  name?: string;
}

interface TideConditionsFetchProps {
  id: string;
}

export type TideConditionsProps = (TideConditionsDataProps | TideConditionsFetchProps) & {
  /** @deprecated Ignored: the widget shows no date. */
  showDate?: boolean;
  /** Fill the parent's height instead of the small widget's 170 px. */
  fill?: boolean;
  /** The current instant; defaults to the clock. Pass it to render deterministically. */
  now?: number;
  className?: string;
};

/** The widget's square: the canvas with the card's fill over it, clipped to the card's corners. */
function Frame({
  fill,
  className,
  children,
}: {
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-(--sw-radius-card) text-white ${fill ? "h-full" : "h-[170px]"} ${className ?? ""}`}
      style={{
        background: "linear-gradient(var(--sw-card-fill), var(--sw-card-fill)), var(--sw-canvas)",
        fontFamily: "var(--sw-font-sans)",
      }}
    >
      {children}
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="m-0 p-4 text-xs text-(--sw-foam)/85">{children}</p>;
}

function TideConditionsStatic({
  timeline,
  extremes,
  units,
  timezone,
  name,
  fill,
  now: fixedNow,
  className,
}: TideConditionsDataProps & { fill?: boolean; now?: number; className?: string }) {
  const { locale } = useSlackwaterConfig();
  const now = useMinuteClock(fixedNow);
  const reading = readTideCard(timeline, extremes, now);

  return (
    <Frame fill={fill} className={className}>
      {reading && timeline.length > 1 ? (
        <>
          {/* The graph clears the name and reading, and bleeds past the sides to leave on its own slope. */}
          <div className="absolute -inset-x-[3px] top-[58px] bottom-0">
            <StationCardGraph
              data={{ kind: "tide", timeline, extremes, units }}
              now={now}
              back={WIDGET_BACK_MS}
              forward={WIDGET_FORWARD_MS}
              timezone={timezone}
              locale={locale}
            />
          </div>
          <div className="relative flex flex-col gap-0.5 p-4">
            {name && <span className="truncate text-[11px] text-(--sw-foam)">{name}</span>}
            <span className="flex">
              <TideReading reading={reading} units={units} locale={locale} compact />
            </span>
          </div>
        </>
      ) : (
        <Message>{EMPTY_TIDE_MESSAGE}</Message>
      )}
    </Frame>
  );
}

function TideConditionsFetcher({
  id,
  fill,
  now: fixedNow,
  className,
}: TideConditionsFetchProps & { fill?: boolean; now?: number; className?: string }) {
  const config = useSlackwaterConfig();
  const now = useMinuteClock(fixedNow);
  // The card's window, so a widget and a card for one station share their queries.
  const hour = Math.floor(now / HOUR) * HOUR;
  const range = useMemo(() => cardRange(hour), [hour]);
  const options = { staleTime: Infinity, placeholderData: keepPreviousData };
  const timeline = useTimeline({ id, ...range.timeline }, options);
  const extremes = useExtremes({ id, ...range.extremes }, options);

  const error = timeline.error ?? extremes.error;
  if (error) {
    return (
      <Frame fill={fill} className={className}>
        <Message>{error.message}</Message>
      </Frame>
    );
  }
  if (!timeline.data || !extremes.data) {
    return (
      <Frame fill={fill} className={className}>
        <div className="flex h-full items-center justify-center" aria-busy="true">
          <Waves />
          <span className="sr-only">Loading</span>
        </div>
      </Frame>
    );
  }

  return (
    <TideConditionsStatic
      timeline={timeline.data.timeline}
      extremes={extremes.data.extremes}
      units={timeline.data.units}
      timezone={config.timezone ?? timeline.data.station.timezone}
      name={timeline.data.station.name}
      fill={fill}
      now={fixedNow}
      className={className}
    />
  );
}

/** SF Symbol `water.waves`: the widget's placeholder while it loads. */
function Waves() {
  return (
    <svg width={30} height={26} viewBox="0 0 30 26" aria-hidden="true">
      <path
        d="M2 5c3-3 5-3 7 0s4 3 6 0 4-3 6 0 4 3 7 0M2 13c3-3 5-3 7 0s4 3 6 0 4-3 6 0 4 3 7 0M2 21c3-3 5-3 7 0s4 3 6 0 4-3 6 0 4 3 7 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The tide now, after the app's small home-screen widget: the station's
 * name, the height with an arrow for rising or falling, and the curve from
 * half a swing back to a swing and a half ahead, whose labels name the next
 * turns. Pass data, or a station ID to fetch it.
 */
export function TideConditions({ fill, now, className, ...props }: TideConditionsProps) {
  if ("id" in props) {
    return <TideConditionsFetcher id={props.id} fill={fill} now={now} className={className} />;
  }
  return <TideConditionsStatic {...props} fill={fill} now={now} className={className} />;
}
