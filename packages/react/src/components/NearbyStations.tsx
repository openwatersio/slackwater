import { useStation } from "../hooks/use-station.js";
import { useNearbyStations } from "../hooks/use-nearby-stations.js";
import { useSlackwaterConfig } from "../provider.js";
import { formatDistance } from "../utils/format.js";
import type { StationSummary } from "../types.js";

export interface NearbyStationsPositionProps {
  latitude: number;
  longitude: number;
  stationId?: undefined;
}

export interface NearbyStationsStationProps {
  stationId: string;
  latitude?: undefined;
  longitude?: undefined;
}

export type NearbyStationsProps = (NearbyStationsPositionProps | NearbyStationsStationProps) & {
  maxResults?: number;
  onStationSelect?: (station: StationSummary) => void;
  /** Called when the user hovers over a station item. */
  onHover?: (station: StationSummary) => void;
  /** Called when the user stops hovering over a station item. */
  onHoverEnd?: (station: StationSummary) => void;
  className?: string;
};

export function NearbyStations(props: NearbyStationsProps) {
  if (props.stationId) {
    return <NearbyFromStation {...props} stationId={props.stationId} />;
  }
  return (
    <NearbyFromPosition
      latitude={props.latitude!}
      longitude={props.longitude!}
      maxResults={props.maxResults}
      onStationSelect={props.onStationSelect}
      onHover={props.onHover}
      onHoverEnd={props.onHoverEnd}
      className={props.className}
    />
  );
}

function NearbyFromStation({
  stationId,
  maxResults,
  onStationSelect,
  onHover,
  onHoverEnd,
  className,
}: {
  stationId: string;
  maxResults?: number;
  onStationSelect?: (station: StationSummary) => void;
  onHover?: (station: StationSummary) => void;
  onHoverEnd?: (station: StationSummary) => void;
  className?: string;
}) {
  const station = useStation(stationId);

  if (station.isLoading)
    return <div className="p-4 text-center text-sm text-(--sw-foam)/62">Loading...</div>;
  if (station.error)
    return (
      <div className="p-4 text-center text-sm text-(--sw-attention)">{station.error.message}</div>
    );

  return (
    <NearbyFromPosition
      latitude={station.data!.latitude}
      longitude={station.data!.longitude}
      excludeId={stationId}
      maxResults={maxResults}
      onStationSelect={onStationSelect}
      onHover={onHover}
      onHoverEnd={onHoverEnd}
      className={className}
    />
  );
}

function NearbyFromPosition({
  latitude,
  longitude,
  excludeId,
  maxResults = 5,
  onStationSelect,
  onHover,
  onHoverEnd,
  className,
}: {
  latitude: number;
  longitude: number;
  excludeId?: string;
  maxResults?: number;
  onStationSelect?: (station: StationSummary) => void;
  onHover?: (station: StationSummary) => void;
  onHoverEnd?: (station: StationSummary) => void;
  className?: string;
}) {
  const config = useSlackwaterConfig();
  const {
    data: stations = [],
    isLoading,
    error,
  } = useNearbyStations({
    latitude,
    longitude,
    maxResults: excludeId ? maxResults + 1 : maxResults,
  });

  if (isLoading)
    return (
      <div className="p-4 text-center text-sm text-(--sw-foam)/62">Loading nearby stations...</div>
    );
  if (error)
    return <div className="p-4 text-center text-sm text-(--sw-attention)">{error.message}</div>;

  return (
    <ul className={`sw-card list-none m-0 p-0 overflow-hidden ${className ?? ""}`}>
      {stations
        .filter((station) => station.id !== excludeId)
        .slice(0, maxResults)
        .map((station) => (
          <li key={station.id} className="border-b border-white/5.5 last:border-b-0">
            <button
              type="button"
              className="flex gap-3 items-center justify-between w-full min-h-11 px-4 py-3 border-none bg-transparent cursor-pointer text-left transition-colors hover:bg-white/5"
              onClick={() => onStationSelect?.(station)}
              onMouseEnter={() => onHover?.(station)}
              onMouseLeave={() => onHoverEnd?.(station)}
              onFocus={() => onHover?.(station)}
              onBlur={() => onHoverEnd?.(station)}
            >
              <div className="min-w-0">
                <span className="block text-[15px] font-medium text-white truncate">
                  {station.name}
                </span>
                <span className="block text-xs text-(--sw-foam)/55 truncate">
                  {[station.region, station.country].filter(Boolean).join(", ")}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {station.distance !== undefined && (
                  <span className="font-mono text-xs tabular-nums text-(--sw-foam)/85">
                    {formatDistance(station.distance * 1000, config.units)}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
    </ul>
  );
}
