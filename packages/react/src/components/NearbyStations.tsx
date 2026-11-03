import { lazy, Suspense } from "react";
import { useSeen } from "../hooks/use-seen.js";
import { MapBoundary } from "./MapBoundary.js";
import { StationList } from "./StationList.js";
const NearbyMap = lazy(() => import("./NearbyMap.js"));
import { useCurrentStation, useCurrentStations } from "../hooks/use-current-station.js";
import { useNearbyStations } from "../hooks/use-nearby-stations.js";
import { useStation } from "../hooks/use-station.js";
import type { StationSummary } from "../types.js";
import { mergeNearby } from "../utils/card.js";
import { NEARBY_RESULTS, nearbyParams } from "../utils/page.js";
import { type CardStation } from "./StationCard.js";
import { StationCredits } from "./StationCredits.js";

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
  showMap?: boolean;
  filter?: StationSummary["kind"];
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
  return (
    <NearStation
      station={station}
      exclude={{ id: station.data?.id ?? stationId, kind: "tide" }}
      {...props}
    />
  );
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
  showMap = false,
  filter,
}: ListProps & {
  latitude: number;
  longitude: number;
  exclude?: { id: string; kind: StationSummary["kind"] };
}) {
  const [mapRef, seen] = useSeen("200px");
  const params = nearbyParams(latitude, longitude, maxResults, !!exclude);
  const tides = useNearbyStations(params);
  const currents = useCurrentStations(params);

  if (tides.isLoading || currents.isLoading) return <Status>Loading nearby stations</Status>;
  // An API without the current routes still lists its tide stations.
  if (tides.error && currents.error) return <Status error>{tides.error.message}</Status>;
  const stations = mergeNearby<CardStation>(
    [
      filter === "current" ? [] : (tides.data ?? []),
      filter === "tide" ? [] : (currents.data ?? []),
    ],
    maxResults,
    exclude,
  );

  return (
    <div>
      <StationList
        stations={stations}
        onSelect={onStationSelect}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        className={className}
      />
      {showMap && stations.length > 0 && (
        <div
          ref={mapRef}
          role="region"
          aria-label="Nearby stations map"
          className="sw-card mt-3 h-[220px] overflow-hidden"
        >
          {seen && (
            <MapBoundary>
              <Suspense
                fallback={
                  <div role="status" className="p-4 text-sm">
                    Loading map…
                  </div>
                }
              >
                <NearbyMap
                  key={stations.map((s) => `${s.kind}:${s.id}`).join(",")}
                  latitude={latitude}
                  longitude={longitude}
                  stations={stations}
                  focusStation={exclude?.id}
                  onStationSelect={onStationSelect}
                />
              </Suspense>
            </MapBoundary>
          )}
        </div>
      )}
      <StationCredits stations={stations} className="mt-3" />
    </div>
  );
}
