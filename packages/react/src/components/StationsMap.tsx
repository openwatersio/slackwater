import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from "react";
import {
  AttributionControl,
  Layer,
  Map,
  Marker,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import {
  keepPreviousData,
  useQueries,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

import { currentTimelineQuery, useCurrentStations } from "../hooks/use-current-station.js";
import { extremesQuery } from "../hooks/use-extremes.js";
import { useStations } from "../hooks/use-stations.js";
import { timelineQuery } from "../hooks/use-timeline.js";
import { useThemeColors, type ThemeColors } from "../hooks/use-theme-colors.js";
import { useSlackwaterConfig } from "../provider.js";
import type { CurrentTimelineResponse, ExtremesResponse, TimelineResponse } from "../types.js";
import { cardRange } from "../utils/card.js";
import { DEFAULT_SLACK_THRESHOLD } from "../utils/current.js";
import { drawPinImage, pinImageId } from "../utils/pin-images.js";
import {
  LOCATE_ZOOM,
  NAME_MIN_ZOOM,
  PIN_CELL,
  PIN_RADIUS,
  PIN_SCALE,
  PIN_VIEWPORT_PAD,
  READING_MIN_ZOOM,
  UNAVAILABLE_PIN,
  UNKNOWN_PIN,
  boxContains,
  boxCovers,
  boxFromBounds,
  currentPinState,
  listingBbox,
  padBox,
  pinRank,
  pinScaleExpression,
  stationKey,
  tidePinState,
  visibleStations,
  type MapStation,
  type PinBox,
  type PinState,
} from "../utils/pin.js";
import { StationCard } from "./StationCard.js";
import { useMinuteClock } from "./StationCardFace.js";

/** OpenFreeMap's fiord: the app's dark basemap, whose water the pin colors are tuned against. */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/fiord";
/** fiord's only fontstack, so station text shares the basemap's glyphs. */
const LABEL_FONT = ["Noto Sans Regular"];
/** The selected pin's disc, in dot radii. */
const SELECTED_DISC = 3.4;
const PANEL_MARGIN = 12;
const HOUR = 3_600_000;

const SOURCE = "sw-stations";
const PIN_LAYER = "sw-pins";

type ManagedMapProps =
  | "onLoad"
  | "onMoveEnd"
  | "onClick"
  | "onMouseEnter"
  | "onMouseLeave"
  | "interactiveLayerIds"
  | "style"
  | "cursor"
  | "attributionControl"
  | "dragRotate"
  | "touchPitch"
  | "pitchWithRotate"
  | "maxPitch";

export interface StationsMapProps extends Omit<ComponentProps<typeof Map>, ManagedMapProps> {
  /** Called when the selected station's card is tapped: the map's way to open a station. */
  onStationSelect?: (station: MapStation) => void;
  /** Called with the visible bounds each time the camera settles. */
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  /** Whether to show the locate button. Defaults to true. */
  showGeolocation?: boolean;
  /** Station ID to mark as selected without opening its card: the station a page is about. */
  focusStation?: string;
  /** Boat-speed threshold for slack, in knots. */
  threshold?: number;
  /** The current instant; defaults to the clock. Pass it to render deterministically. */
  now?: number;
  /** CSS class applied to the outer wrapper div. */
  className?: string;
}

/** Predictions never change for a fixed window, and the window moves on the hour. */
const PREDICTIONS = { staleTime: Infinity };

const pinData = (results: UseQueryResult<unknown>[]) => results.map((r) => r.data);

const TONE_COLOR: Record<string, keyof ThemeColors> = {
  rising: "graphHigh",
  falling: "graphLow",
  slack: "go",
  unknown: "steel",
};

function pinColor(state: PinState, colors: ThemeColors): string {
  const named = TONE_COLOR[state.tone];
  return named ? colors[named] : state.tone;
}

const zoomRamp = (from: number, to: number) =>
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    READING_MIN_ZOOM,
    from,
    PIN_SCALE.to,
    to,
  ] as unknown as ExpressionSpecification;

function layers(colors: ThemeColors): LayerProps[] {
  const caption = {
    "text-font": LABEL_FONT,
    "text-size": zoomRamp(11, 13),
  };
  const captionPaint = {
    "text-color": colors.mapLabel,
    "text-halo-color": colors.mapInk,
    "text-halo-width": 1,
  };
  // MapLibre places symbols from the last layer back: pins claim space first, then readings, then names.
  return [
    {
      id: "sw-selected",
      type: "circle",
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": pinScaleExpression(
          PIN_RADIUS * SELECTED_DISC,
        ) as unknown as ExpressionSpecification,
        "circle-color": colors.mapLabel,
        "circle-opacity": 0.18,
      },
    },
    {
      id: "sw-names",
      type: "symbol",
      minzoom: NAME_MIN_ZOOM,
      layout: {
        ...caption,
        "symbol-sort-key": ["get", "rank"],
        "text-field": ["get", "name"],
        "text-anchor": "top",
        "text-padding": 4,
        "text-offset": [
          "interpolate",
          ["linear"],
          ["zoom"],
          READING_MIN_ZOOM,
          ["literal", [0, 1]],
          PIN_SCALE.to,
          ["literal", [0, 2.4]],
        ],
      },
      paint: captionPaint,
    },
    {
      id: "sw-readings",
      type: "symbol",
      minzoom: READING_MIN_ZOOM,
      filter: ["all", ["has", "reading"], ["!=", ["get", "shape"], "gauge"]],
      layout: {
        ...caption,
        "symbol-sort-key": ["get", "rank"],
        "text-field": ["get", "reading"],
        // An arrow is nearly square, so any side will do.
        "text-variable-anchor": ["bottom", "top", "left", "right"],
        "text-radial-offset": zoomRamp(0.9, 1.5),
        "text-justify": "auto",
      },
      paint: captionPaint,
    },
    {
      id: "sw-readings-tide",
      type: "symbol",
      minzoom: READING_MIN_ZOOM,
      filter: ["==", ["get", "shape"], "gauge"],
      layout: {
        ...caption,
        "symbol-sort-key": ["get", "rank"],
        "text-field": ["get", "reading"],
        // A gauge is three times taller than wide, so its reading sits beside the bar.
        "text-variable-anchor": ["left", "right"],
        "text-radial-offset": zoomRamp(0.7, 1),
        "text-justify": "auto",
      },
      paint: captionPaint,
    },
    {
      id: PIN_LAYER,
      type: "symbol",
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": pinScaleExpression() as unknown as ExpressionSpecification,
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        // Always drawn, but still registered so no text lands on a pin.
        "icon-allow-overlap": true,
        "icon-ignore-placement": false,
      },
    },
  ];
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * The app's stations map: every tide and current station in view as a live
 * pin on the dark fiord basemap, thinned to one per 44 px cell. A tap shows
 * the station's card in a panel; tapping the card calls `onStationSelect`.
 */
export const StationsMap = forwardRef<MapRef, StationsMapProps>(function StationsMap(
  {
    onStationSelect,
    onBoundsChange,
    focusStation,
    showGeolocation = true,
    threshold = DEFAULT_SLACK_THRESHOLD,
    now: fixedNow,
    mapStyle = BASEMAP_STYLE,
    children,
    className,
    ...mapProps
  },
  ref,
) {
  const config = useSlackwaterConfig();
  const colors = useThemeColors();
  const now = useMinuteClock(fixedNow);
  const mapRef = useRef<MapRef | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<{ view: PinBox; zoom: number } | null>(null);
  const [listBox, setListBox] = useState<PinBox | null>(null);
  const [selected, setSelected] = useState<MapStation | null>(null);
  const [hovering, setHovering] = useState(false);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);

  const bbox = listBox ? listingBbox(listBox) : undefined;
  const listing = { enabled: !!bbox, placeholderData: keepPreviousData };
  const tides = useStations(bbox ? { bbox } : {}, listing);
  const currents = useCurrentStations(bbox ? { bbox } : {}, listing);

  const stations = useMemo<MapStation[]>(
    () => [...(tides.data ?? []), ...(currents.data ?? [])],
    [tides.data, currents.data],
  );
  const selectedKey = selected ? stationKey(selected) : undefined;
  const pinned = useMemo(() => {
    const focus = stations.find((s) => s.id === focusStation);
    return [selectedKey, focus && stationKey(focus)].filter((k): k is string => !!k);
  }, [stations, focusStation, selectedKey]);

  const visible = useMemo(
    () =>
      camera
        ? visibleStations(stations, padBox(camera.view, PIN_VIEWPORT_PAD), camera.zoom, pinned)
        : [],
    [stations, camera, pinned],
  );

  // Pins read the card's own queries, so a pin and the card it opens share one fetch.
  const hour = Math.floor(now / HOUR) * HOUR;
  const range = useMemo(() => cardRange(hour), [hour]);
  const detailed = !!camera && camera.zoom >= READING_MIN_ZOOM;
  const queries = useMemo(
    () =>
      visible.flatMap((s): UseQueryOptions<unknown>[] => {
        const enabled =
          detailed && s.predictions !== false && boxContains(camera!.view, s.latitude, s.longitude);
        const options = { ...PREDICTIONS, enabled };
        return s.kind === "tide"
          ? [
              { ...timelineQuery(config, { id: s.id, ...range.timeline }), ...options },
              { ...extremesQuery(config, { id: s.id, ...range.extremes }), ...options },
            ]
          : [{ ...currentTimelineQuery(config.baseUrl, s.id, range.timeline), ...options }];
      }),
    [visible, detailed, camera, config, range],
  );
  const data = useQueries({ queries, combine: pinData });
  // useQueries can't keep previous data, so each pin keeps its last window until the next hour's loads.
  const held = useRef(new globalThis.Map<string, unknown[]>());

  const pins = useMemo<FeatureCollection<Point>>(() => {
    let i = 0;
    const holding = new globalThis.Map<string, unknown[]>();
    const features = visible.map((s): Feature<Point> => {
      const key = stationKey(s);
      const count = s.kind === "tide" ? 2 : 1;
      const fresh = data.slice(i, (i += count));
      const own = fresh.every((d) => d !== undefined) ? fresh : (held.current.get(key) ?? fresh);
      holding.set(key, own);
      let state: PinState;
      if (s.kind === "tide") {
        const [timeline, extremes] = own as [TimelineResponse?, ExtremesResponse?];
        state =
          timeline && extremes
            ? tidePinState(
                timeline.timeline,
                extremes.extremes,
                timeline.units,
                now,
                detailed,
                config.locale,
              )
            : UNKNOWN_PIN;
      } else {
        const [timeline] = own as [CurrentTimelineResponse?];
        const sets = timeline?.station.current;
        state = timeline
          ? currentPinState(
              timeline.timeline,
              { flood: sets?.flood_direction, ebb: sets?.ebb_direction },
              threshold,
              now,
              detailed,
              config.locale,
            )
          : UNKNOWN_PIN;
      }
      if (s.predictions === false) state = UNAVAILABLE_PIN;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.longitude, s.latitude] },
        properties: {
          key,
          name: s.name,
          rank: pinRank(s),
          shape: state.shape,
          icon: pinImageId(state, pinColor(state, colors)),
          bearing: state.bearing ?? 0,
          ...(state.reading && { reading: state.reading }),
          ...(pinned.includes(key) && { selected: true }),
        },
      };
    });
    held.current = holding;
    return { type: "FeatureCollection", features };
  }, [visible, data, now, detailed, threshold, colors, config.locale, pinned]);

  const byKey = useMemo(
    () => new globalThis.Map(visible.map((s) => [stationKey(s), s])),
    [visible],
  );

  const settle = useCallback(
    (map: MapLibreMap) => {
      const b = map.getBounds();
      const view = boxFromBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
      setCamera({ view, zoom: map.getZoom() });
      setListBox((held) => (held && boxCovers(held, view) ? held : padBox(view, PIN_VIEWPORT_PAD)));
      onBoundsChange?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    },
    [onBoundsChange],
  );

  const handleLoad = useCallback(
    (e: { target: MapLibreMap }) => {
      const map = e.target;
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      const draw = (id: string) => {
        const drawn = drawPinImage(id, colors.mapInk);
        if (drawn && !map.hasImage(id))
          map.addImage(id, drawn.image, { pixelRatio: drawn.pixelRatio });
      };
      // The resolver arrived in MapLibre 6; earlier versions only fire the event.
      if (map.setMissingStyleImageResolver) map.setMissingStyleImageResolver(draw);
      else map.on("styleimagemissing", ({ id }: { id: string }) => draw(id));
      settle(map);
    },
    [colors.mapInk, settle],
  );

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const map = e.target;
      // A tap can land before the pins join the style, or while a new style loads.
      if (!map.getLayer(PIN_LAYER)) return;
      const { x, y } = e.point;
      const half = PIN_CELL / 2;
      const hits = map.queryRenderedFeatures(
        [
          [x - half, y - half],
          [x + half, y + half],
        ],
        { layers: [PIN_LAYER] },
      );
      let nearest: MapStation | undefined;
      let best = Infinity;
      for (const hit of hits) {
        const [lon, lat] = (hit.geometry as Point).coordinates;
        const p = map.project([lon, lat]);
        const d = Math.hypot(p.x - x, p.y - y);
        const station = byKey.get(hit.properties.key as string);
        if (station && d < best) [nearest, best] = [station, d];
      }
      setSelected(nearest ?? null);
    },
    [byKey],
  );

  // Center the picked pin in the map the panel and its note leave uncovered.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const cover = (panelRef.current?.offsetHeight ?? 0) + PANEL_MARGIN;
    map.easeTo({ center: [selected.longitude, selected.latitude], offset: [0, -cover / 2] });
    // Keyed on the pick alone, so a listing refresh of the same station leaves the camera be.
  }, [selectedKey]);

  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({ latitude: coords.latitude, longitude: coords.longitude });
        mapRef.current?.easeTo({ center: [coords.longitude, coords.latitude], zoom: LOCATE_ZOOM });
      },
      () => {
        // A refused or failed fix leaves the camera where it is.
      },
    );
  }, []);

  const loading = !tides.data && !currents.data && (tides.isFetching || currents.isFetching);
  const failed = tides.isError && currents.isError;
  const mapLayers = useMemo(() => layers(colors), [colors]);

  return (
    <div
      className={`sw-map relative h-full w-full overflow-hidden bg-(--sw-canvas) ${className ?? ""}`}
    >
      <Map
        {...mapProps}
        ref={(map) => {
          mapRef.current = map;
          setRef(ref, map);
        }}
        mapStyle={mapStyle}
        onLoad={handleLoad}
        onMoveEnd={(e) => settle(e.target)}
        onClick={handleClick}
        interactiveLayerIds={[PIN_LAYER]}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        cursor={hovering ? "pointer" : "grab"}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        maxPitch={0}
      >
        <AttributionControl position="top-right" compact />
        <Source id={SOURCE} type="geojson" data={pins}>
          {mapLayers.map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </Source>
        {position && (
          <Marker longitude={position.longitude} latitude={position.latitude}>
            <div className="maplibregl-user-location-dot" />
          </Marker>
        )}
      </Map>

      {showGeolocation && "geolocation" in navigator && !selected && (
        <button
          type="button"
          onClick={locate}
          className="sw-glass absolute bottom-6 left-4 flex size-14 cursor-pointer items-center justify-center rounded-full border-0 text-(--sw-foam)"
          aria-label="My Location"
        >
          <svg
            viewBox="0 0 24 24"
            width="21"
            height="21"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.5 3.5 3.8 10.6l7 2.6 2.6 7z" />
          </svg>
        </button>
      )}

      {(loading || failed) && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <span
            role="status"
            className="sw-glass rounded-full px-3 py-1.5 text-xs text-(--sw-foam)"
          >
            {failed ? "Failed to load stations" : "Loading stations…"}
          </span>
        </div>
      )}

      {/* The note stacks above an open card, so it stays in view while readings are on screen. */}
      <div
        ref={panelRef}
        className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto flex max-w-[440px] flex-col items-center gap-2"
      >
        <span
          className={`sw-glass rounded-full px-3 py-1.5 text-[11px] text-(--sw-foam) ${selected ? "" : "mb-3"}`}
        >
          Not for navigation.
        </span>
        {selected && (
          <div
            className="pointer-events-auto w-full rounded-(--sw-radius-card) bg-(--sw-canvas)"
            style={{ minHeight: 168, boxShadow: "0 8px 28px rgb(0 20 50 / 0.4)" }}
          >
            <StationCard
              key={selectedKey}
              station={selected}
              onSelect={onStationSelect}
              threshold={threshold}
              now={fixedNow}
            />
          </div>
        )}
      </div>

      {children}
    </div>
  );
});
