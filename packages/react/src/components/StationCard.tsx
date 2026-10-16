import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { keepPreviousData } from "@tanstack/react-query";

import { useCurrentEvents, useCurrentTimeline } from "../hooks/use-current-station.js";
import { useExtremes } from "../hooks/use-extremes.js";
import { useTimeline } from "../hooks/use-timeline.js";
import { useSlackwaterConfig } from "../provider.js";
import type { StationSummary } from "../types.js";
import { cardRange, readCurrentCard, readTideCard } from "../utils/card.js";
import { DEFAULT_SLACK_THRESHOLD, EMPTY_MESSAGE, slackRuns } from "../utils/current.js";
import { EMPTY_TIDE_MESSAGE } from "../utils/tide.js";
import { CurrentReading, StationCardFace, TideReading, useMinuteClock } from "./StationCardFace.js";
import { StationCardGraph } from "./StationCardGraph.js";

const HOUR = 3_600_000;

/** A station as a card reads it. */
export type CardStation = StationSummary;

export interface StationCardProps {
  station: CardStation;
  /** Kilometers from where a list measures, shown in nautical miles. */
  distance?: number;
  /** Makes the card a link. */
  href?: string;
  /**
   * Called when the card is activated; without `href` the card is a button.
   * With `href`, a plain click calls it in place of following the link, and a
   * modified or middle click opens the link as usual.
   */
  onSelect?: (station: CardStation) => void;
  /** Boat-speed threshold for a current's slack windows, in knots. */
  threshold?: number;
  /** The current instant; defaults to the clock. Pass it to render deterministically. */
  now?: number;
  className?: string;
}

/** True once the element comes within a screen of the viewport, and from then on. */
function useSeen() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    // Without the observer (jsdom, old browsers) a card can't tell, so it loads now.
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/**
 * A station's card, after the app's: its name and region, the reading now,
 * and the curve a swing and a half back and two and a half ahead. The card
 * loads its own predictions once it scrolls near the viewport.
 */
export function StationCard({
  station,
  distance,
  href,
  onSelect,
  threshold = DEFAULT_SLACK_THRESHOLD,
  now: fixedNow,
  className,
}: StationCardProps) {
  const [ref, seen] = useSeen();
  const now = useMinuteClock(fixedNow);
  const identity = {
    name: station.name,
    region: station.region ?? station.country,
    distance,
  };
  const body =
    station.predictions === false ? (
      <StationCardFace
        {...identity}
        // The listing's reason is a paragraph; the station's own page gives it in full.
        status="Predictions aren't available for this station."
        quiet
      />
    ) : station.kind === "current" ? (
      <CurrentCardBody
        station={station}
        identity={identity}
        seen={seen}
        now={now}
        threshold={threshold}
      />
    ) : (
      <TideCardBody station={station} identity={identity} seen={seen} now={now} />
    );
  const look = `block w-full rounded-(--sw-radius-card) text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--sw-go) ${className ?? ""}`;
  const select =
    onSelect &&
    ((event: MouseEvent) => {
      if (href) {
        // A modified or middle click is the reader asking for the link itself, in a new tab or window.
        const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (modified || event.button !== 0) return;
        event.preventDefault();
      }
      onSelect(station);
    });

  return (
    <div ref={ref}>
      {href ? (
        <a href={href} onClick={select} className={`${look} no-underline`}>
          {body}
        </a>
      ) : select ? (
        <button
          type="button"
          onClick={select}
          className={`${look} cursor-pointer border-0 bg-transparent p-0`}
        >
          {body}
        </button>
      ) : (
        <div className={look}>{body}</div>
      )}
    </div>
  );
}

interface BodyProps {
  station: CardStation;
  identity: { name: string; region: string; distance?: number };
  seen: boolean;
  now: number;
}

const PREDICTIONS = {
  // Predictions for a fixed window never change.
  staleTime: Infinity,
  // A card moving to the next hour keeps the last window until the new one loads.
  placeholderData: keepPreviousData,
};

/** The card's window, which moves on the hour. */
function useCardRange(now: number) {
  const hour = Math.floor(now / HOUR) * HOUR;
  return useMemo(() => cardRange(hour), [hour]);
}

function TideCardBody({ station, identity, seen, now }: BodyProps) {
  const { locale } = useSlackwaterConfig();
  const range = useCardRange(now);
  const options = { ...PREDICTIONS, enabled: seen };
  const timeline = useTimeline({ id: station.id, ...range.timeline }, options);
  const extremes = useExtremes({ id: station.id, ...range.extremes }, options);
  const error = timeline.error ?? extremes.error;
  if (error) return <StationCardFace {...identity} status={error.message} />;
  if (!timeline.data || !extremes.data) return <StationCardFace {...identity} loading />;

  const { units } = timeline.data;
  const reading = readTideCard(timeline.data.timeline, extremes.data.extremes, now);
  if (!reading) return <StationCardFace {...identity} status={EMPTY_TIDE_MESSAGE} />;
  return (
    <StationCardFace
      {...identity}
      reading={<TideReading reading={reading} units={units} locale={locale} />}
      graph={
        <StationCardGraph
          data={{
            kind: "tide",
            timeline: timeline.data.timeline,
            extremes: extremes.data.extremes,
            units,
            chartDatum: !!timeline.data.datum,
          }}
          now={now}
          timezone={station.timezone}
          locale={locale}
        />
      }
    />
  );
}

function CurrentCardBody({
  station,
  identity,
  seen,
  now,
  threshold,
}: BodyProps & { threshold: number }) {
  const { locale } = useSlackwaterConfig();
  const range = useCardRange(now).timeline;
  const timeline = useCurrentTimeline(station.id, seen ? range : undefined);
  const events = useCurrentEvents(station.id, seen ? range : undefined);
  const runs = useMemo(
    () =>
      timeline.data && events.data
        ? slackRuns(timeline.data.timeline, events.data.events, threshold)
        : [],
    [timeline.data, events.data, threshold],
  );
  const error = timeline.error ?? events.error;
  if (error) return <StationCardFace {...identity} status={error.message} />;
  if (!timeline.data || !events.data) return <StationCardFace {...identity} loading />;

  const sets = timeline.data.station.current;
  const reading = readCurrentCard(
    timeline.data.timeline,
    runs,
    { flood: sets?.flood_direction, ebb: sets?.ebb_direction },
    now,
  );
  if (!reading) return <StationCardFace {...identity} status={EMPTY_MESSAGE} />;
  return (
    <StationCardFace
      {...identity}
      reading={<CurrentReading reading={reading} locale={locale} />}
      graph={
        <StationCardGraph
          data={{
            kind: "current",
            timeline: timeline.data.timeline,
            events: events.data.events,
            runs,
          }}
          now={now}
          timezone={station.timezone}
          locale={locale}
        />
      }
    />
  );
}
