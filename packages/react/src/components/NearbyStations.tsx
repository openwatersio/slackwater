import { useCurrentStation, useCurrentStations } from "../hooks/use-current-station.js";
import { useNearbyStations } from "../hooks/use-nearby-stations.js";
import { useStation } from "../hooks/use-station.js";
import type { StationSummary } from "../types.js";
import { mergeNearby } from "../utils/card.js";
import { NEARBY_RESULTS, nearbyParams } from "../utils/page.js";
import { StationCard, type CardStation } from "./StationCard.js";

export interface NearbyStationsPositionProps {
  latitude: number;
  longitude: number;
  stationId?: undefined;
  kind?: undefined;
}

export interface NearbyStationsStationProps {
  stationId: string;
  /** Which routes serve `stationId`; a tide station by default. */
  kind?: StationSummary["kind"];
  latitude?: undefined;
  longitude?: undefined;
}

export type NearbyStationsProps = (NearbyStationsPositionProps | NearbyStationsStationProps) & {
  maxResults?: number;
  onStationSelect?: (station: CardStation) => void;
  /** Called when the user hovers over or focuses a station. */
  onHover?: (station: CardStation) => void;
  /** Called when the user stops hovering over or focusing a station. */
  onHoverEnd?: (station: CardStation) => void;
  className?: string;
};

type ListProps = Omit<NearbyStationsProps, "stationId" | "kind" | "latitude" | "longitude">;

/** The tide and current stations nearest a station or a position, as cards with their distance. */
export function NearbyStations({
  stationId,
  kind,
  latitude,
  longitude,
  ...props
}: NearbyStationsProps) {
  if (stationId !== undefined) {
    return kind === "current" ? (
      <NearCurrentStation stationId={stationId} {...props} />
    ) : (
      <NearTideStation stationId={stationId} {...props} />
    );
  }
  return <NearbyFromPosition latitude={latitude} longitude={longitude} {...props} />;
}

function NearTideStation({ stationId, ...props }: ListProps & { stationId: string }) {
  const station = useStation(stationId);
  return <NearStation station={station} exclude={{ id: stationId, kind: "tide" }} {...props} />;
}

function NearCurrentStation({ stationId, ...props }: ListProps & { stationId: string }) {
  const station = useCurrentStation(stationId);
  // Listings name each station by its primary bin.
  const id = stationId.split("@")[0];
  return <NearStation station={station} exclude={{ id, kind: "current" }} {...props} />;
}

function NearStation({
  station,
  exclude,
  ...props
}: ListProps & {
  station: { data?: StationSummary; error: Error | null };
  exclude: { id: string; kind: StationSummary["kind"] };
}) {
  if (station.error) return <Status error>{station.error.message}</Status>;
  if (!station.data) return <Status>Loading nearby stations</Status>;
  return (
    <NearbyFromPosition
      latitude={station.data.latitude}
      longitude={station.data.longitude}
      exclude={exclude}
      {...props}
    />
  );
}

function Status({ error, children }: { error?: boolean; children: string }) {
  return error ? (
    <p className="m-0 p-4 text-center text-sm text-(--sw-attention)">{children}</p>
  ) : (
    <p className="sr-only" role="status">
      {children}
    </p>
  );
}

function NearbyFromPosition({
  latitude,
  longitude,
  exclude,
  maxResults = NEARBY_RESULTS,
  onStationSelect,
  onHover,
  onHoverEnd,
  className,
}: ListProps & {
  latitude: number;
  longitude: number;
  exclude?: { id: string; kind: StationSummary["kind"] };
}) {
  const params = nearbyParams(latitude, longitude, maxResults, !!exclude);
  const tides = useNearbyStations(params);
  const currents = useCurrentStations(params);

  if (tides.isLoading || currents.isLoading) return <Status>Loading nearby stations</Status>;
  // An API without the current routes still lists its tide stations.
  if (tides.error && currents.error) return <Status error>{tides.error.message}</Status>;
  const stations = mergeNearby<CardStation>(
    [tides.data ?? [], currents.data ?? []],
    maxResults,
    exclude,
  );

  return (
    <ul className={`m-0 flex list-none flex-col gap-3 p-0 ${className ?? ""}`}>
      {stations.map((station) => (
        <li
          key={`${station.kind}:${station.id}`}
          onMouseEnter={() => onHover?.(station)}
          onMouseLeave={() => onHoverEnd?.(station)}
          onFocus={() => onHover?.(station)}
          onBlur={() => onHoverEnd?.(station)}
        >
          <StationCard station={station} distance={station.distance} onSelect={onStationSelect} />
        </li>
      ))}
    </ul>
  );
}
