import { describe, test, expect, inject, vi } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { prefetchTideStation, prefetchNearbyStations } from "../src/prefetch.js";
import { NearbyStations } from "../src/components/NearbyStations.js";
import { TideStation } from "../src/components/TideStation.js";
import { createQueryClient } from "../src/provider.js";
import { queryKeys } from "../src/query-keys.js";
import { createTestWrapper } from "./helpers.js";

const STATION_ID = "noaa/8443970";

describe("prefetchTideStation", () => {
  test("populates the station, its week, the fortnight of extremes, and both Nearby lists", async () => {
    const queryClient = new QueryClient();

    await prefetchTideStation(queryClient, inject("apiBaseUrl"), STATION_ID, {
      units: "meters",
    });

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBe(6);
    for (const query of queries) {
      expect(query.state.status).toBe("success");
    }
  });

  // Fort Wadsworth has no datums, so a datum the browser saved would change the page's keys.
  test.each([STATION_ID, "noaa/8519024"])(
    "fills every list and prediction TideStation reads for %s",
    async (id) => {
      localStorage.setItem("slackwater-settings", JSON.stringify({ datum: "MLLW" }));
      // The provider's client, whose lists stay fresh for the page's first render.
      const queryClient = createQueryClient();
      await prefetchTideStation(queryClient, inject("apiBaseUrl"), id, { locale: "en-US" });
      const fetch = vi.spyOn(window, "fetch");

      render(createElement(TideStation, { id }), {
        wrapper: createTestWrapper({ queryClient, units: "feet" }),
      });

      expect(await screen.findByRole("slider", undefined, { timeout: 10000 })).toBeDefined();
      const nearby = await screen.findByRole("region", { name: "Nearby" });
      expect(await within(nearby).findByRole("list")).toBeDefined();
      // Nearby cards load their own stations' predictions; the page's lists and predictions are all prefetched.
      const urls = fetch.mock.calls.map(([url]) => String(url));
      expect(urls.filter((u) => u.includes(id) || /\/stations\?/.test(u))).toEqual([]);
      fetch.mockRestore();
    },
  );

  test("resolves for an unknown station, leaving its query in error", async () => {
    const queryClient = new QueryClient();

    await expect(
      prefetchTideStation(queryClient, inject("apiBaseUrl"), "noaa/does-not-exist"),
    ).resolves.toBeUndefined();

    expect(queryClient.getQueryState(queryKeys.station("noaa/does-not-exist"))?.status).toBe(
      "error",
    );
  });

  test("skips predictions for a station the API can't serve", async () => {
    const queryClient = new QueryClient();

    await prefetchTideStation(queryClient, inject("apiBaseUrl"), "chs-campbell-river");

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[1]);
    expect(keys.sort()).toEqual(["current-stations", "nearby-stations", "station"]);
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
