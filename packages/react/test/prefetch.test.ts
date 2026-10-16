import { describe, test, expect, inject, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { prefetchTideStation, prefetchNearbyStations } from "../src/prefetch.js";
import { TideStation } from "../src/components/TideStation.js";
import { createTestWrapper } from "./helpers.js";

const STATION_ID = "noaa/8443970";

describe("prefetchTideStation", () => {
  test("populates the query cache with station, timeline, and extremes", async () => {
    const queryClient = new QueryClient();

    await prefetchTideStation(queryClient, inject("apiBaseUrl"), STATION_ID, {
      units: "meters",
    });

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBe(3);
    for (const query of queries) {
      expect(query.state.status).toBe("success");
    }
  });

  test("fills exactly the predictions TideStation reads", async () => {
    const queryClient = new QueryClient();
    await prefetchTideStation(queryClient, inject("apiBaseUrl"), STATION_ID, { locale: "en-US" });
    const fetch = vi.spyOn(window, "fetch");

    render(createElement(TideStation, { id: STATION_ID }), {
      wrapper: createTestWrapper({ queryClient, units: "feet" }),
    });

    expect(await screen.findByRole("slider", undefined, { timeout: 10000 })).toBeDefined();
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => /\/(timeline|extremes)\?/.test(u))).toEqual([]);
    fetch.mockRestore();
  });
});

describe("prefetchNearbyStations", () => {
  test("populates the query cache with nearby stations", async () => {
    const queryClient = new QueryClient();

    await prefetchNearbyStations(queryClient, inject("apiBaseUrl"), {
      latitude: 42.35,
      longitude: -71.05,
    });

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBe(1);
    expect(queries[0].state.status).toBe("success");
    expect(Array.isArray(queries[0].state.data)).toBe(true);
  });
});
