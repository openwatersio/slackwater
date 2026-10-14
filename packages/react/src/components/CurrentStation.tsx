import { useEffect, useMemo, useState } from "react";

import { useSlackwaterConfig } from "../provider.js";
import {
  useCurrentEvents,
  useCurrentStation,
  useCurrentTimeline,
} from "../hooks/use-current-station.js";
import { startOfDay } from "../utils/time.js";
import { CurrentScrubber } from "./CurrentScrubber.js";

const HOUR = 3_600_000;

export interface CurrentStationProps {
  /** "source/id", optionally with a depth bin: "noaa/PUG1701", "noaa/EPT0003@11". */
  id: string;
  /** Boat-speed threshold for slack windows, in knots. */
  threshold?: number;
  className?: string;
}

/** A current station's detail view, after the app's current detail screen. */
export function CurrentStation({ id, threshold, className }: CurrentStationProps) {
  const { locale } = useSlackwaterConfig();
  const station = useCurrentStation(id);
  const timezone = station.data?.timezone;
  // A page left open for days moves its window when it is next shown two local days on.
  const [shownAt, setShownAt] = useState(() => Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setShownAt(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const today = timezone ? startOfDay(shownAt, timezone) : undefined;
  const [anchor, setAnchor] = useState<number>();
  // One day on, the loaded window still reaches 156 h ahead, and re-fetching could fail offline.
  if (today !== undefined && (anchor === undefined || Math.abs(today - anchor) > 36 * HOUR)) {
    setAnchor(today);
  }
  // Four days back, so a strip up to about 3,400 px wide can still center now.
  // ponytail: a fixed online window; endless 7-day chunks come with the local engine adapter.
  const range = useMemo(
    () =>
      anchor === undefined
        ? undefined
        : {
            start: new Date(anchor - 96 * HOUR).toISOString(),
            end: new Date(anchor + 180 * HOUR).toISOString(),
          },
    [anchor],
  );
  const usable = station.data?.predictions ? range : undefined;
  const timeline = useCurrentTimeline(id, usable);
  const events = useCurrentEvents(id, usable);

  const s = station.data;
  const error = station.error ?? timeline.error ?? events.error;

  return (
    <section
      className={`text-white ${className ?? ""}`}
      style={{ background: "var(--sw-canvas, #05122a)" }}
    >
      <header className="px-5 pt-5 pb-2">
        <h1 className="m-0 text-2xl font-semibold">{s?.name ?? " "}</h1>
        <p
          className="m-0 mt-0.5 text-xs"
          style={{ color: "var(--sw-foam, #e4f0e4)", opacity: 0.55 }}
        >
          {s ? [s.region, s.country].filter(Boolean).join(" · ") : " "}
        </p>
      </header>
      {s && !s.predictions ? (
        <p className="px-5 py-8 text-sm opacity-80">
          {s.unavailable ?? "Predictions aren't available for this station."}
        </p>
      ) : s && timeline.data && events.data ? (
        <CurrentScrubber
          timeline={timeline.data.timeline}
          events={events.data.events}
          timezone={s.timezone}
          latitude={s.latitude}
          longitude={s.longitude}
          directions={{ flood: s.current?.flood_direction, ebb: s.current?.ebb_direction }}
          threshold={threshold}
          locale={locale}
        />
      ) : error ? (
        <p className="px-5 py-8 text-sm opacity-80">{error.message}</p>
      ) : (
        <div style={{ height: 396 }} aria-busy="true" />
      )}
      {s && (s.disclaimers || s.attribution) && (
        <footer
          className="px-5 pb-5 pt-2 text-xs"
          style={{ color: "var(--sw-foam, #e4f0e4)", opacity: 0.55 }}
        >
          {s.disclaimers && <p className="m-0">{s.disclaimers}</p>}
          {s.attribution && <p className="m-0 mt-1">{s.attribution}</p>}
        </footer>
      )}
    </section>
  );
}
