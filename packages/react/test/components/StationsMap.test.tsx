import { describe, test, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { StationsMap } from "../../src/components/StationsMap.js";
import { createTestWrapper } from "../helpers.js";

// Empty style so the map needs no network to reach a loaded state. Starting MapLibre
// can still take over a second while other test files run in parallel.
const style = { version: 8 as const, sources: {}, layers: [] };

describe("StationsMap", () => {
  test("builds a map with the station layers", async () => {
    const ref = createRef<MapRef>();
    render(
      <StationsMap
        ref={ref}
        mapStyle={style}
        initialViewState={{ longitude: -123, latitude: 48, zoom: 6 }}
      />,
      { wrapper: createTestWrapper() },
    );

    await waitFor(() => expect(ref.current).toBeTruthy(), { timeout: 10000 });
    const map = ref.current!.getMap();
    await waitFor(() => expect(map.isStyleLoaded()).toBe(true), { timeout: 10000 });

    expect(map.getSource("stations")).toBeTruthy();
    expect(map.getLayer("clusters")).toBeTruthy();
    expect(map.getLayer("cluster-count")).toBeTruthy();
    expect(map.getLayer("unclustered-point")).toBeTruthy();
    expect(map.getLayer("station-labels")).toBeTruthy();
  });

  test("reports bounds once the map loads", async () => {
    const bounds: { north: number; south: number; east: number; west: number }[] = [];
    render(
      <StationsMap
        mapStyle={style}
        initialViewState={{ longitude: -123, latitude: 48, zoom: 6 }}
        onBoundsChange={(b) => bounds.push(b)}
      />,
      { wrapper: createTestWrapper() },
    );

    await waitFor(() => expect(bounds.length).toBeGreaterThan(0), { timeout: 10000 });
    const { north, south, east, west } = bounds[0];
    expect(north).toBeGreaterThan(south);
    expect(east).toBeGreaterThan(west);
  });
});
