import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { StationsMap } from "../../src/components/StationsMap.js";
import { createTestWrapper } from "../helpers.js";

/** A small map, so each view asks the shared test API for few stations and leaves it free for other files. */
function mapWrapper() {
  const Provider = createTestWrapper();
  return function MapWrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider>
        <div style={{ width: 400, height: 300 }}>{children}</div>
      </Provider>
    );
  };
}

// Empty style so the map needs no network to reach a loaded state. Starting MapLibre
// can still take over a second while other test files run in parallel.
const style = { version: 8 as const, sources: {}, layers: [] };
const SEATTLE = { longitude: -122.3393, latitude: 47.6026 };
// One instant for every assertion, so a pin's state can't move between them.
const NOW = Date.UTC(2026, 9, 15, 19, 30);

async function loadedMap(ref: React.RefObject<MapRef | null>) {
  await waitFor(() => expect(ref.current).toBeTruthy(), { timeout: 10000 });
  const map = ref.current!.getMap();
  await waitFor(() => expect(map.isStyleLoaded()).toBe(true), { timeout: 10000 });
  return map;
}

/** Every feature in the pin source, margin included: querySourceFeatures sees only loaded tiles. */
function sourcePins(map: MapLibreMap) {
  const source = map.getSource("sw-stations") as GeoJSONSource;
  return (source.serialize().data as FeatureCollection<Point>).features;
}

/** A tap at a canvas point, as MapLibre's click handler expects it. */
function tap(canvas: HTMLCanvasElement, x: number, y: number) {
  const rect = canvas.getBoundingClientRect();
  const at = { clientX: rect.x + x, clientY: rect.y + y, bubbles: true };
  for (const type of ["mousedown", "mouseup", "click"]) {
    canvas.dispatchEvent(new MouseEvent(type, at));
  }
}

describe("StationsMap", () => {
  test("builds its layers on a north-up camera and reports the bounds", async () => {
    const ref = createRef<MapRef>();
    const bounds: { north: number; south: number; east: number; west: number }[] = [];
    render(
      <StationsMap
        ref={ref}
        mapStyle={style}
        initialViewState={{ longitude: -123, latitude: 48, zoom: 6 }}
        onBoundsChange={(b) => bounds.push(b)}
      />,
      { wrapper: mapWrapper() },
    );

    const map = await loadedMap(ref);
    // The source joins the style a render after it loads.
    await waitFor(() => expect(map.getSource("sw-stations")).toBeTruthy(), { timeout: 10000 });
    for (const id of ["sw-selected", "sw-names", "sw-readings", "sw-readings-tide", "sw-pins"]) {
      expect(map.getLayer(id)).toBeTruthy();
    }
    expect(map.getLayoutProperty("sw-pins", "icon-size")).toEqual([
      "interpolate",
      ["exponential", 1.7],
      ["zoom"],
      6,
      0.4,
      12.5,
      1.8,
    ]);
    expect(map.getLayer("sw-names")!.minzoom).toBe(10.5);
    expect(map.getLayer("sw-readings")!.minzoom).toBe(9.5);
    expect(map.dragRotate.isEnabled()).toBe(false);
    expect(map.getMaxPitch()).toBe(0);
    expect(screen.getByText("Not for navigation.")).toBeTruthy();

    await waitFor(() => expect(bounds.length).toBeGreaterThan(0), { timeout: 10000 });
    const { north, south, east, west } = bounds[0];
    expect(north).toBeGreaterThan(south);
    expect(east).toBeGreaterThan(west);
  });

  test("draws live pins, holds them while the next hour loads, and dots below the reading zoom", async () => {
    const ref = createRef<MapRef>();
    const props = {
      ref,
      mapStyle: style,
      initialViewState: { ...SEATTLE, zoom: 10.5 },
      focusStation: "noaa/9447130",
    };
    const { rerender } = render(<StationsMap {...props} now={NOW} />, { wrapper: mapWrapper() });
    const map = await loadedMap(ref);
    const icons = () => sourcePins(map).map((f) => f.properties!);
    const seattle = () => icons().find((p) => p.key === "tide:noaa/9447130");

    await waitFor(
      () => {
        const pins = icons();
        expect(pins.some((p) => String(p.icon).startsWith("sw-pin|gauge|"))).toBe(true);
        expect(pins.some((p) => String(p.icon).startsWith("sw-pin|arrow|"))).toBe(true);
        expect(seattle()?.selected).toBe(true);
        expect(seattle()?.reading).toMatch(/^-?\d+\.\d (ft|m)$/);
        expect(seattle()?.icon).toMatch(/^sw-pin\|gauge\|/);
      },
      { timeout: 15000 },
    );

    // The next hour is a new window, not yet loaded.
    rerender(<StationsMap {...props} now={NOW + 3_600_000} />);
    expect(seattle()?.icon).toMatch(/^sw-pin\|gauge\|/);

    map.jumpTo({ zoom: 8 });
    await waitFor(
      () => expect(icons().every((p) => !String(p.icon).startsWith("sw-pin|gauge|"))).toBe(true),
      { timeout: 10000 },
    );
  });

  test("asks for predictions only for stations in view at the reading zoom", async () => {
    const ref = createRef<MapRef>();
    const fetches = vi.spyOn(window, "fetch");
    const predicted = () =>
      fetches.mock.calls
        .map(([url]) => String(url).match(/\/stations\/(.+)\/timeline\?/)?.[1])
        .filter((id): id is string => !!id);
    try {
      render(
        <StationsMap
          ref={ref}
          mapStyle={style}
          now={NOW}
          initialViewState={{ ...SEATTLE, zoom: 9 }}
        />,
        { wrapper: mapWrapper() },
      );
      const map = await loadedMap(ref);
      await waitFor(() => expect(sourcePins(map).length).toBeGreaterThan(0), { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(fetches.mock.calls.some(([url]) => String(url).includes("/stations?bbox="))).toBe(
        true,
      );
      expect(predicted()).toEqual([]);

      map.jumpTo({ zoom: 10.5 });
      await waitFor(() => expect(predicted().length).toBeGreaterThan(0), { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const bounds = map.getBounds();
      const pins = sourcePins(map);
      const at = (id: string) =>
        pins.find((f) => String(f.properties!.key).endsWith(`:${id}`))!.geometry.coordinates as [
          number,
          number,
        ];
      expect(pins.some((f) => !bounds.contains(f.geometry.coordinates as [number, number]))).toBe(
        true,
      );
      for (const id of predicted()) expect(bounds.contains(at(id))).toBe(true);
    } finally {
      fetches.mockRestore();
    }
  });

  test("a tap shows the station's card, the card opens it, and water deselects", async () => {
    const ref = createRef<MapRef>();
    const onStationSelect = vi.fn();
    const { container } = render(
      <StationsMap
        ref={ref}
        mapStyle={style}
        now={NOW}
        initialViewState={{ ...SEATTLE, zoom: 12 }}
        onStationSelect={onStationSelect}
      />,
      { wrapper: mapWrapper() },
    );
    const map = await loadedMap(ref);
    await waitFor(
      () =>
        expect(
          map
            .queryRenderedFeatures({ layers: ["sw-pins"] })
            .some((f) => f.properties.key === "tide:noaa/9447130"),
        ).toBe(true),
      { timeout: 15000 },
    );

    const canvas = container.querySelector("canvas")!;
    const pin = map.project([SEATTLE.longitude, SEATTLE.latitude]);
    // Clear of the glyph, which is about 13 px wide here, but inside its 44 px target.
    tap(canvas, pin.x - 20, pin.y);
    const card = await screen.findByRole("button", { name: /Seattle/ }, { timeout: 10000 });
    expect(screen.queryByRole("button", { name: "My Location" })).toBeNull();
    await waitFor(
      () =>
        expect(
          sourcePins(map).find((f) => f.properties!.key === "tide:noaa/9447130")?.properties!
            .selected,
        ).toBe(true),
      { timeout: 10000 },
    );

    fireEvent.click(card);
    expect(onStationSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "noaa/9447130", kind: "tide" }),
    );

    // The panel's pan has to finish before a canvas point means a place.
    await waitFor(() => expect(map.isMoving()).toBe(false), { timeout: 5000 });
    tap(canvas, 5, 5);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Seattle/ })).toBeNull());

    // A tap while the pins are out of the style, as before they load, is ignored;
    // react-map-gl would catch a throwing handler and log it.
    map.removeLayer("sw-pins");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      tap(canvas, 10, 10);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
