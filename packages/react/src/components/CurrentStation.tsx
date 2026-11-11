import { useMemo } from "react";

import { useSlackwaterConfig } from "../provider.js";
import {
  useCurrentEvents,
  useCurrentStation,
  useCurrentTimeline,
} from "../hooks/use-current-station.js";
import type { CurrentEvent, CurrentStationInfo } from "../types.js";
import { formatSpeed, formatSet } from "../utils/current.js";
import type { ScheduleEntry } from "../utils/schedule.js";
import { nextMaxTile } from "../utils/standing.js";
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
  useFortnight,
  useScheduleSync,
  useSelected,
  useStationWeek,
  type Selection,
} from "./StationPage.js";
import { SummaryTiles } from "./SummaryTiles.js";

export interface CurrentStationProps {
  /** "source/id", optionally with a depth bin: "noaa/PUG1701", "noaa/EPT0003@11". */
  id: string;
  /** Major-axis speed threshold for axis windows, in knots. */
  threshold?: number;
  /** Called when a nearby station is picked; its `kind` says which page it belongs on. */
  onStationSelect?: (station: CardStation) => void;
  className?: string;
}

const degrees = (d: number) => formatSet(d, "degrees");

/** Where the speeds come from, after the app's current footer. */
function provenance(station: CurrentStationInfo, reference: string | undefined) {
  const flood = station.current?.flood_direction;
  const sets = flood === undefined ? "" : ` Flood bearing ${degrees(flood)}.`;
  const axis =
    " Bearings are measured from true north. The reading shows full predicted speed and Set, the direction water flows toward. The graph, maxima and axis windows use the flood/ebb component; crossing flow can remain at an axis zero. Schedule headings use published flood/ebb bearings; Set uses them when rotation data is unavailable.";
  if (station.type === "subordinate") {
    const whose = reference ? `${reference}'s ` : "";
    return `NOAA subordinate station: ${whose}slacks, maxima, and minima, corrected by published offsets.${sets}${axis}`;
  }
  if (station.id?.startsWith("noaa/")) {
    return `NOAA harmonic current prediction.${sets}${axis}`;
  }
  const source = station.source?.name;
  return source ? `Harmonic constants from ${source}.${sets}${axis}` : `${sets}${axis}`.trim();
}

/** The tiles at the scrubber's moment: the maximum the water is heading for, and the Moon. */
function CurrentTiles(props: {
  selection: Selection;
  now: number;
  events: CurrentEvent[];
  fortnight: CurrentEvent[] | undefined;
  timezone: string;
  latitude: number;
  longitude: number;
  locale?: string;
}) {
  const time = useSelected(props.selection) ?? props.now;
  return (
    <SummaryTiles
      time={time}
      timezone={props.timezone}
      latitude={props.latitude}
      longitude={props.longitude}
      locale={props.locale}
      primary={nextMaxTile(props.events, time, props.fortnight, props.timezone, props.locale)}
    />
  );
}

/** A current station's detail page, after the app's current detail screen. */
export function CurrentStation(props: CurrentStationProps) {
  // A new station starts a new page, so no week, pick, or previous data carries over.
  return <CurrentPage key={props.id} {...props} />;
}

function CurrentPage({ id, threshold, onStationSelect, className }: CurrentStationProps) {
  const { locale, setFormat } = useSlackwaterConfig();
  const station = useCurrentStation(id);
  const s = station.data;
  const week = useStationWeek(s?.timezone);
  const usable = s?.predictions ? week.range : undefined;
  const timeline = useCurrentTimeline(id, usable);
  const events = useCurrentEvents(id, usable);
  const fortnight = useFortnight(s?.timezone);
  const standing = useCurrentEvents(id, s?.predictions ? fortnight : undefined);
  const referenceId = s?.type === "subordinate" ? s.current?.offsets?.reference : undefined;
  const ref = useCurrentStation(referenceId).data;

  const flood = s?.current?.flood_direction;
  const ebb = s?.current?.ebb_direction;
  const entries = useMemo(
    () =>
      events.data?.events.map((e): ScheduleEntry => {
        const time = e.time.getTime();
        if (e.kind === "slack") return { time, pill: "slack" };
        const value = `${formatSpeed(e.speed, locale)} kn axis`;
        if (e.kind === "minFlood") return { time, pill: "minFlood", value, direction: flood };
        if (e.kind === "minEbb") return { time, pill: "minEbb", value, direction: ebb };
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
            setFormat={setFormat}
            threshold={threshold}
            locale={locale}
            onSelect={sync.onSelect}
            moveTo={sync.moveTo}
            onNow={sync.onNow}
          />
          <CurrentTiles
            selection={sync.selection}
            now={week.now}
            events={events.data.events}
            fortnight={standing.data?.events}
            timezone={s.timezone}
            latitude={s.latitude}
            longitude={s.longitude}
            locale={locale}
          />
          <div className="mt-[26px]">
            <Schedule
              days={sync.days}
              setFormat={setFormat}
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
                    label="Major-axis mean flow"
                    value={
                      Math.abs(meanFlow) < 0.05
                        ? "None measured"
                        : `${formatSpeed(meanFlow, locale)} kn axis toward ${meanFlow > 0 ? "flood" : "ebb"}`
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
          <StationNearby
            id={id}
            attribution={s.attribution}
            kind="current"
            onStationSelect={onStationSelect}
          />
        </>
      )}
    </StationPage>
  );
}
