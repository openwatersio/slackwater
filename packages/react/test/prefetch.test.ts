import { afterEach, describe, test, expect, inject, vi } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { prefetchTideStation, prefetchNearbyStations } from "../src/prefetch.js";
import { NearbyStations } from "../src/components/NearbyStations.js";
import { TideStation } from "../src/components/TideStation.js";
import { createQueryClient } from "../src/provider.js";
import { createApiDataSource } from "../src/data-source.js";
import { queryKeys } from "../src/query-keys.js";
import { createTestWrapper } from "./helpers.js";

const STATION_ID = "noaa/8443970";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("prefetchTideStation", () => {
  test("populates the station, its week, its outlook, the fortnight of extremes, and both Nearby lists", async () => {
    const queryClient = new QueryClient();

    await prefetchTideStation(queryClient, inject("apiBaseUrl"), STATION_ID, {
      units: "meters",
    });

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBe(7);
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
    },
  );

  test("fills every list and prediction TideStation reads just after the station's midnight", async () => {
    // Half past midnight in Boston, when the strip's opening starts on the day before.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-10T05:30:00Z"));
    const queryClient = createQueryClient();
    await prefetchTideStation(queryClient, inject("apiBaseUrl"), STATION_ID, { locale: "en-US" });
    const fetch = vi.spyOn(window, "fetch");

    render(createElement(TideStation, { id: STATION_ID }), {
      wrapper: createTestWrapper({ queryClient, units: "feet" }),
    });

    const slider = await screen.findByRole("slider", undefined, { timeout: 10000 });
    const nearby = await screen.findByRole("region", { name: "Nearby" });
    expect(await within(nearby).findByRole("list")).toBeDefined();
    // The strip's pill becomes reachable once the opening has come to rest.
    const pill = () =>
      within(slider.parentElement!)
        .getAllByRole("button")
        .find((b) => !/now/i.test(b.ariaLabel ?? ""));
    await waitFor(() => expect(pill()?.tabIndex).toBe(0), { timeout: 4000 });
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.includes(STATION_ID) || /\/stations\?/.test(u))).toEqual([]);
  });

  test("resolves for an unknown station, leaving its query in error", async () => {
    const queryClient = new QueryClient();

    await expect(
      prefetchTideStation(queryClient, inject("apiBaseUrl"), "noaa/does-not-exist"),
    ).resolves.toBeUndefined();

    expect(
      queryClient.getQueryState(
        queryKeys.station(
          "noaa/does-not-exist",
          createApiDataSource(inject("apiBaseUrl")).cacheKey,
        ),
      )?.status,
    ).toBe("error");
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
  });
});
