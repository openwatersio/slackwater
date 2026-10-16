import { useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";

import { useExtremes } from "../hooks/use-extremes.js";
import { useStation } from "../hooks/use-station.js";
import { useTimeline } from "../hooks/use-timeline.js";
import { useSlackwaterConfig } from "../provider.js";
import type { Station } from "../types.js";
import type { ScheduleEntry } from "../utils/schedule.js";
import { formatHeight, heightUnit } from "../utils/tide.js";
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
import { TideScrubber } from "./TideScrubber.js";

export interface TideStationProps {
  /** "source/id": "noaa/9447130". */
  id: string;
  /** Called when a nearby station is picked; its `kind` says which page it belongs on. */
  onStationSelect?: (station: CardStation) => void;
  className?: string;
}

/** Where the heights come from, after the app's tide footer. */
function provenance(station: Station, datum: string | undefined, reference: string | undefined) {
  const base = datum ? `${datum} chart datum. ` : "";
  if (station.type === "subordinate") {
    return `${base}Based on ${reference ?? "reference station"} tides and NOAA's published offsets.`;
  }
  if (station.id.startsWith("noaa/")) return `${base}NOAA harmonic prediction.`;
  return `${base}Harmonic constants from ${station.source.name}.`;
}

/**
 * A tide station's detail page, after the app's tide detail: the scrubbing
 * strip with its lead reading, the week's highs and lows, and where the
 * numbers come from. Heights are always above the station's chart datum.
 */
export function TideStation({ id, onStationSelect, className }: TideStationProps) {
  const { locale, units: preferred } = useSlackwaterConfig();
  const station = useStation(id);
  const s = station.data;
  const week = useStationWeek(s?.timezone);
  const params = s && week.range ? { id, ...week.range, datum: s.defaultDatum } : undefined;
  const query = {
    enabled: !!params,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  };
  const timeline = useTimeline(params ?? { id }, query);
  const extremes = useExtremes(params ?? { id }, query);
  const reference = useStation(s?.type === "subordinate" ? s.offsets?.reference : undefined);

  const units = timeline.data?.units ?? preferred;
  const datum = timeline.data?.datum ?? s?.defaultDatum;
  const entries = useMemo(
    () =>
      extremes.data?.extremes.map((e): ScheduleEntry => ({
        time: e.time.getTime(),
        pill: e.high ? "high" : "low",
        value: `${formatHeight(e.level, units, locale)} ${heightUnit(units)}`,
      })),
    [extremes.data, units, locale],
  );
  const sync = useScheduleSync(entries, week, s?.timezone);
  const error = station.error ?? timeline.error ?? extremes.error;
  const ref = reference.data;

  return (
    <StationPage name={s?.name} region={s?.region ?? s?.country} className={className}>
      {error ? (
        <p className="m-0 px-5 py-8 text-sm opacity-80">{error.message}</p>
      ) : s && timeline.data && extremes.data && week.anchor !== undefined ? (
        <>
          <TideScrubber
            timeline={timeline.data.timeline}
            extremes={extremes.data.extremes}
            timezone={s.timezone}
            latitude={s.latitude}
            longitude={s.longitude}
            units={units}
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
      ) : (
        <StripPlaceholder />
      )}
      {s && (
        <>
          <StationFooter
            provenance={provenance(s, datum, ref?.name)}
            disclaimers={s.disclaimers}
            attribution={s.attribution}
          />
          <StationDetails>
            {datum && (
              <DetailRow
                label="Datum"
                value={
                  s.id.startsWith("noaa/") ? `${datum} (NOAA chart datum)` : `${datum} chart datum`
                }
              />
            )}
            <DetailNote>
              Heights are measured from chart datum. A negative value predicts less water than the
              charted depth.
            </DetailNote>
            <DetailRow label="Station" value={s.id} />
            <DetailRow label="Position" value={formatCoord(s.latitude, s.longitude)} />
            <DetailRow label="Time zone" value={s.timezone} />
            {ref && (
              <DetailRow label="Reference" value={`${ref.name}, ${distanceKm(s, ref)} km away`} />
            )}
          </StationDetails>
          <StationNearby id={id} kind="tide" onStationSelect={onStationSelect} />
        </>
      )}
    </StationPage>
  );
}
