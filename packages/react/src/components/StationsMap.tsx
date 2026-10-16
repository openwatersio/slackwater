import {
  useState,
  useCallback,
  useMemo,
  forwardRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Map,
  Source,
  Layer,
  Popup,
  type MapRef,
  type ViewStateChangeEvent,
  type MapLayerMouseEvent,
  type MapEvent,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import { keepPreviousData } from "@tanstack/react-query";

import { useStation } from "../hooks/use-station.js";
import { useStations } from "../hooks/use-stations.js";
import { useDebouncedCallback } from "../hooks/use-debounced-callback.js";
import { useThemeColors } from "../hooks/use-theme-colors.js";
import { TideConditions } from "./TideConditions.js";
import type { StationSummary } from "../types.js";

// Props that StationsMap manages internally and cannot be overridden
type ManagedMapProps = "onMove" | "onClick" | "interactiveLayerIds" | "style" | "cursor";

export interface StationsMapProps extends Omit<ComponentProps<typeof Map>, ManagedMapProps> {
  onStationSelect?: (station: StationSummary) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  /** Whether to show the geolocation button. Defaults to true. */
  showGeolocation?: boolean;
  /** Station ID to highlight with a larger marker. The marker is never absorbed by clusters. */
  focusStation?: string;
  /** Enable clustering of station markers. Defaults to true. */
  clustering?: boolean;
  /** Max zoom level at which clusters are generated. Defaults to 14. */
  clusterMaxZoom?: number;
  /** Cluster radius in pixels. Defaults to 50. */
  clusterRadius?: number;
  /**
   * Controls popup content when clicking a station.
   * - `"preview"` (default): shows station name + next tide (fetched), only at zoom >= 10
   * - `"simple"`: shows station name + region, no API call, no zoom gate
   * - function: receives station summary, return ReactNode, no zoom gate
   * - `false`: disables popups entirely (onStationSelect still fires)
   */
  popupContent?: "preview" | "simple" | ((station: StationSummary) => ReactNode) | false;
  /** CSS class applied to the outer wrapper div. */
  className?: string;
}

function stationsToGeoJSON(stations: StationSummary[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map(({ longitude, latitude, ...properties }) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties,
    })),
  };
}

function StationPreviewCard({ stationId }: { stationId: string }) {
  return <TideConditions id={stationId} showDate={false} />;
}

export const StationsMap = forwardRef<MapRef, StationsMapProps>(function StationsMap(
  {
    onStationSelect,
    onBoundsChange,
    focusStation,
    showGeolocation = true,
    clustering = true,
    clusterMaxZoom: clusterMaxZoomProp = 7,
    clusterRadius: clusterRadiusProp = 50,
    popupContent = "preview",
    children,
    className,
    ...mapProps
  },
  ref,
) {
  const [viewState, setViewState] = useState(mapProps.initialViewState ?? {});
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const debouncedSetBbox = useDebouncedCallback(setBbox, 200);
  const [selectedStation, setSelectedStation] = useState<StationSummary | null>(null);

  const colors = useThemeColors();

  const {
    data: stations = [],
    isLoading,
    isError,
  } = useStations(bbox ? { bbox: bbox.join(",") } : {}, {
    enabled: bbox !== null,
    placeholderData: keepPreviousData,
  });

  // Focus station: fetch if not in loaded stations, build separate GeoJSON
  const focusStationInList = focusStation ? stations.find((s) => s.id === focusStation) : undefined;
  const { data: fetchedFocusStation } = useStation(
    focusStation && !focusStationInList ? focusStation : undefined,
  );
  const focusStationData: StationSummary | undefined =
    focusStationInList ?? (fetchedFocusStation as StationSummary | undefined);

  const geojson = useMemo(
    () =>
      stationsToGeoJSON(focusStation ? stations.filter((s) => s.id !== focusStation) : stations),
    [stations, focusStation],
  );

  const focusGeoJSON: FeatureCollection | null = useMemo(() => {
    if (!focusStationData) return null;
    return stationsToGeoJSON([focusStationData]);
  }, [focusStationData]);

  const updateBbox = useCallback(
    (e: MapEvent) => {
      const map = e.target;
      const mapBounds = map.getBounds();
      const sw = mapBounds.getSouthWest();
      const ne = mapBounds.getNorthEast();
      debouncedSetBbox([sw.lng, sw.lat, ne.lng, ne.lat]);
      onBoundsChange?.({
        north: mapBounds.getNorth(),
        south: mapBounds.getSouth(),
        east: mapBounds.getEast(),
        west: mapBounds.getWest(),
      });
    },
    [onBoundsChange, debouncedSetBbox],
  );

  const handleMove = useCallback(
    (e: ViewStateChangeEvent) => {
      setViewState(e.viewState);
      updateBbox(e);
    },
    [updateBbox],
  );

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties;

      // Cluster click → zoom in
      if (props?.cluster) {
        setViewState((prev) => ({
          ...prev,
          longitude: (feature.geometry as Point).coordinates[0],
          latitude: (feature.geometry as Point).coordinates[1],
          zoom: Math.min((prev.zoom ?? 3) + 2, 18),
        }));
        return;
      }

      // Station point click
      if (props?.id) {
        const coords = (feature.geometry as Point).coordinates;
        const station = {
          ...props,
          latitude: coords[1],
          longitude: coords[0],
        } as StationSummary;

        if (popupContent !== false) {
          setSelectedStation(station);
        }

        onStationSelect?.(station);
      }
    },
    [onStationSelect, popupContent],
  );

  const handleLocateMe = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setViewState((prev) => ({
          ...prev,
          longitude: pos.coords.longitude,
          latitude: pos.coords.latitude,
          zoom: Math.max(prev.zoom ?? 0, 10),
        }));
      },
      () => {
        // Silently ignore geolocation errors
      },
    );
  }, []);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <Map
        ref={ref}
        {...mapProps}
        {...viewState}
        onLoad={updateBbox}
        onMove={handleMove}
        onClick={handleMapClick}
        interactiveLayerIds={["clusters", "unclustered-point"]}
        style={{ width: "100%", height: "100%" }}
        cursor="pointer"
        attributionControl={false}
      >
        <Source
          id="stations"
          type="geojson"
          data={geojson}
          cluster={clustering}
          clusterMaxZoom={clusterMaxZoomProp}
          clusterRadius={clusterRadiusProp}
        >
          {/* Clustered circles */}
          <Layer
            id="clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": colors.steel,
              "circle-radius": ["step", ["get", "point_count"], 18, 50, 24, 200, 30],
              "circle-stroke-width": 2,
              "circle-stroke-color": colors.mapInk,
            }}
          />

          {/* Cluster count labels */}
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 12,
              "text-allow-overlap": true,
            }}
            paint={{
              "text-color": colors.mapLabel,
            }}
          />

          {/* Unclustered stations: a steel dot on an ink plate, since the map reads no state yet. */}
          <Layer
            id="unclustered-point"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": colors.steel,
              "circle-radius": 5,
              "circle-stroke-width": 2.5,
              "circle-stroke-color": colors.mapInk,
            }}
          />

          {/* Station name labels at higher zoom */}
          <Layer
            id="station-labels"
            type="symbol"
            filter={["!", ["has", "point_count"]]}
            minzoom={7}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 13,
              "text-offset": [0, 1.5],
              "text-anchor": "top",
              "text-max-width": 10,
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            }}
            paint={{
              "text-color": colors.mapLabel,
              "text-halo-color": colors.mapInk,
              "text-halo-width": 1,
            }}
          />
        </Source>

        {/* Focus station — rendered above clusters, never absorbed */}
        {focusGeoJSON && (
          <Source id="focus-station" type="geojson" data={focusGeoJSON}>
            <Layer
              id="focus-station-point"
              type="circle"
              paint={{
                "circle-color": colors.paper,
                "circle-radius": 8,
                "circle-stroke-width": 3,
                "circle-stroke-color": colors.mapInk,
              }}
            />
            <Layer
              id="focus-station-label"
              type="symbol"
              layout={{
                "text-field": ["get", "name"],
                "text-size": 14,
                "text-offset": [0, 1.8],
                "text-anchor": "top",
                "text-max-width": 10,
                "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              }}
              paint={{
                "text-color": colors.mapLabel,
                "text-halo-color": colors.mapInk,
                "text-halo-width": 1,
              }}
            />
          </Source>
        )}

        {/* Station popup */}
        {selectedStation && popupContent !== false && (
          <Popup
            longitude={selectedStation.longitude}
            latitude={selectedStation.latitude}
            maxWidth="none"
            offset={10}
            onClose={() => setSelectedStation(null)}
            closeOnClick={false}
            closeButton={false}
            className="sw-popup"
          >
            <div className="relative">
              {typeof popupContent === "function" ? (
                popupContent(selectedStation)
              ) : (
                <>
                  <div className="flex gap-2 justify-between items-start mb-2">
                    <div className="text-base font-semibold text-white">{selectedStation.name}</div>
                    <button
                      type="button"
                      onClick={() => setSelectedStation(null)}
                      className="text-(--sw-foam)/55 hover:text-white cursor-pointer leading-4 text-lg"
                      aria-label="Close popup"
                    >
                      ×
                    </button>
                  </div>
                  {popupContent === "simple" ? (
                    <div className="text-xs text-(--sw-foam)/55">
                      {[selectedStation.region, selectedStation.country].filter(Boolean).join(", ")}
                    </div>
                  ) : (
                    <StationPreviewCard stationId={selectedStation.id} />
                  )}
                </>
              )}
            </div>
          </Popup>
        )}
      </Map>

      {/* Locate me button */}
      {showGeolocation && "geolocation" in navigator && (
        <button
          type="button"
          onClick={handleLocateMe}
          className="absolute bottom-6 right-3 z-10 w-8 h-8 flex items-center justify-center bg-(--sw-canvas) border border-(--sw-card-stroke) rounded-lg shadow-md cursor-pointer hover:bg-(--sw-shadow) transition-colors"
          aria-label="Center map on my location"
          title="My location"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-(--sw-foam)"
          >
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      )}

      {isError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--sw-canvas) border border-(--sw-card-stroke) shadow-md text-sm text-(--sw-foam)/70">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Failed to load stations
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--sw-canvas) border border-(--sw-card-stroke) shadow-md text-sm text-(--sw-foam)/70">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-spin"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Loading stations…
          </div>
        </div>
      )}

      {children}
    </div>
  );
});
