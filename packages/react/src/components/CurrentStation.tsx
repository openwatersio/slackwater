import { useMemo } from "react";

import { useSlackwaterConfig } from "../provider.js";
import {
  useCurrentEvents,
  useCurrentStation,
  useCurrentTimeline,
} from "../hooks/use-current-station.js";
import type { CurrentStationInfo } from "../types.js";
import { formatSpeed } from "../utils/current.js";
import type { ScheduleEntry } from "../utils/schedule.js";
import { CurrentScrubber } from "./CurrentScrubber.js";
import { Schedule } from "./Schedule.js";
import type { CardStation } from "./StationCard.js";
import {
  DetailNote,
  DetailRow,
  StationDetails,
  StationFooter,
  StationNearby,
  StationPage,
  StripPlaceholder,
  distanceKm,
  formatCoord,
  useScheduleSync,
  useStationWeek,
} from "./StationPage.js";

export interface CurrentStationProps {
  /** "source/id", optionally with a depth bin: "noaa/PUG1701", "noaa/EPT0003@11". */
  id: string;
  /** Boat-speed threshold for slack windows, in knots. */
  threshold?: number;
  /** Called when a nearby station is picked; its `kind` says which page it belongs on. */
  onStationSelect?: (station: CardStation) => void;
  className?: string;
}

const degrees = (d: number) => `${Math.round(d)}°T`;

/** Where the speeds come from, after the app's current footer. */
function provenance(station: CurrentStationInfo, reference: string | undefined) {
  const flood = station.current?.flood_direction;
  const sets = flood === undefined ? "" : ` Flood sets ${degrees(flood)}.`;
  if (station.type === "subordinate") {
    const whose = reference ? `${reference}'s ` : "";
    return `NOAA subordinate station: ${whose}slacks and maxima, corrected by published offsets.${sets}`;
  }
  if (station.id?.startsWith("noaa/")) {
    return `NOAA harmonic current prediction.${sets} Speeds use knots.`;
  }
  const source = station.source?.name;
  return source ? `Harmonic constants from ${source}.${sets}` : sets.trim() || undefined;
}

/** A current station's detail page, after the app's current detail screen. */
export function CurrentStation({ id, threshold, onStationSelect, className }: CurrentStationProps) {
  const { locale } = useSlackwaterConfig();
  const station = useCurrentStation(id);
  const s = station.data;
  const week = useStationWeek(s?.timezone);
  const usable = s?.predictions ? week.range : undefined;
  const timeline = useCurrentTimeline(id, usable);
  const events = useCurrentEvents(id, usable);
  const referenceId = s?.type === "subordinate" ? s.current?.offsets?.reference : undefined;
  const ref = useCurrentStation(referenceId).data;

  const flood = s?.current?.flood_direction;
  const ebb = s?.current?.ebb_direction;
  const entries = useMemo(
    () =>
      events.data?.events.map((e): ScheduleEntry => {
        const time = e.time.getTime();
        if (e.kind === "slack") return { time, pill: "slack" };
        const value = `${formatSpeed(e.speed, locale)} kn`;
        return e.kind === "maxFlood"
          ? { time, pill: "flood", value, direction: flood }
          : { time, pill: "ebb", value, direction: ebb };
      }),
    [events.data, flood, ebb, locale],
  );
  const sync = useScheduleSync(entries, week, s?.timezone);
  const error = station.error ?? timeline.error ?? events.error;
  const meanFlow = s?.current?.mean_flow;

  return (
    <StationPage name={s?.name} region={s?.region ?? s?.country} className={className}>
      {s && !s.predictions ? (
        <p className="m-0 px-5 py-8 text-sm opacity-80">
          {s.unavailable ?? "Predictions aren't available for this station."}
        </p>
      ) : s && timeline.data && events.data && week.anchor !== undefined ? (
        <>
          <CurrentScrubber
            timeline={timeline.data.timeline}
            events={events.data.events}
            timezone={s.timezone}
            latitude={s.latitude}
            longitude={s.longitude}
            directions={{ flood, ebb }}
            threshold={threshold}
            locale={locale}
            onSelect={sync.onSelect}
            moveTo={sync.moveTo}
            onNow={sync.onNow}
          />
          <div className="mt-3.5">
            <Schedule
              days={sync.days}
              timezone={s.timezone}
              latitude={s.latitude}
              longitude={s.longitude}
              anchor={week.anchor}
              now={week.now}
              highlight={sync.highlight}
              locale={locale}
              onSelect={sync.onRow}
              onPick={sync.onPick}
            />
          </div>
        </>
      ) : error ? (
        <p className="m-0 px-5 py-8 text-sm opacity-80">{error.message}</p>
      ) : (
        <StripPlaceholder />
      )}
      {s && (
        <>
          <StationFooter
            provenance={s.predictions ? provenance(s, ref?.name) : undefined}
            disclaimers={s.disclaimers}
            attribution={s.attribution}
          />
          {s.predictions && (
            <StationDetails>
              <DetailRow label="Station" value={s.id} />
              <DetailRow label="Position" value={formatCoord(s.latitude, s.longitude)} />
              <DetailRow label="Time zone" value={s.timezone} />
              {flood !== undefined && <DetailRow label="Flood sets" value={degrees(flood)} />}
              {ebb !== undefined && <DetailRow label="Ebb sets" value={degrees(ebb)} />}
              {s.type !== "subordinate" && meanFlow !== undefined && (
                <>
                  <DetailRow
                    label="Mean flow"
                    value={
                      Math.abs(meanFlow) < 0.05
                        ? "None measured"
                        : `${formatSpeed(meanFlow, locale)} kn toward ${meanFlow > 0 ? "flood" : "ebb"}`
                    }
                  />
                  <DetailNote>
                    Mean flow is the net drift remaining after the tide averages out.
                  </DetailNote>
                </>
              )}
              {ref && (
                <DetailRow label="Reference" value={`${ref.name}, ${distanceKm(s, ref)} km away`} />
              )}
            </StationDetails>
          )}
          <StationNearby id={id} kind="current" onStationSelect={onStationSelect} />
        </>
      )}
    </StationPage>
  );
}
