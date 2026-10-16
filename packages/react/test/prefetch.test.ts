import { describe, test, expect, inject, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { prefetchTideStation, prefetchNearbyStations } from "../src/prefetch.js";
import { NearbyStations } from "../src/components/NearbyStations.js";
import { TideStation } from "../src/components/TideStation.js";
import { createQueryClient } from "../src/provider.js";
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
    expect(urls.filter((u) => u.includes(`/${STATION_ID}/`))).toEqual([]);
    fetch.mockRestore();
  });
});

describe("prefetchNearbyStations", () => {
  test("fills exactly the tide and current lists NearbyStations reads", async () => {
    // The provider's client, whose lists stay fresh for the page's first render.
    const queryClient = createQueryClient();
    const position = { latitude: 48.4062, longitude: -122.6431 };
    // Five, without a station to leave out.
    await prefetchNearbyStations(queryClient, inject("apiBaseUrl"), { ...position, maxResults: 5 });

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBe(2);
    for (const query of queries) expect(query.state.status).toBe("success");

    const fetch = vi.spyOn(window, "fetch");
    render(createElement(NearbyStations, position), {
      wrapper: createTestWrapper({ queryClient }),
    });
    expect(await screen.findByRole("list")).toBeDefined();
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => /\/stations\?/.test(u))).toEqual([]);
    fetch.mockRestore();
  });
});
