import { describe, test, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createRef, type Ref } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { StationsMap, type StationsMapProps } from "../../src/components/StationsMap.js";
import { createTestWrapper } from "../helpers.js";

// Empty style so the map needs no network to reach a loaded state.
const style = { version: 8 as const, sources: {}, layers: [] };

type Bounds = Parameters<NonNullable<StationsMapProps["onBoundsChange"]>>[0];

// StationsMap reports bounds from the map's load event, so this resolves once
// the map loads, however long that takes on a slow runner.
function renderLoaded(
  props: Omit<StationsMapProps, "onBoundsChange"> & { ref?: Ref<MapRef> } = {},
) {
  return new Promise<Bounds>((onBoundsChange) => {
    render(
      <StationsMap
        mapStyle={style}
        initialViewState={{ longitude: -123, latitude: 48, zoom: 6 }}
        onBoundsChange={onBoundsChange}
        {...props}
      />,
      { wrapper: createTestWrapper() },
    );
  });
}

describe("StationsMap", () => {
  test("builds a map with the station layers", async () => {
    const ref = createRef<MapRef>();
    await renderLoaded({ ref });
    // react-map-gl sets the ref and adds sources a tick after the map loads,
    // and isStyleLoaded() turns false again while a source loads.
    await waitFor(() => {
      const map = ref.current!.getMap();
      expect(map.getSource("stations")).toBeTruthy();
      expect(map.getLayer("clusters")).toBeTruthy();
      expect(map.getLayer("cluster-count")).toBeTruthy();
      expect(map.getLayer("unclustered-point")).toBeTruthy();
      expect(map.getLayer("station-labels")).toBeTruthy();
    });
  });

  test("reports bounds once the map loads", async () => {
    const { north, south, east, west } = await renderLoaded();
    expect(north).toBeGreaterThan(south);
    expect(east).toBeGreaterThan(west);
  });
});
