import { type QueryClient } from "@tanstack/react-query";

import type { Station, Units } from "./types.js";
import { queryKeys } from "./query-keys.js";
import { fetchStation, fetchStations, fetchCurrentStations } from "./client.js";
import { extremesQuery } from "./hooks/use-extremes.js";
import { timelineQuery } from "./hooks/use-timeline.js";
import { getDefaultUnits } from "./utils/defaults.js";
import { NEARBY_RESULTS, PAGE_NEARBY_RESULTS, nearbyParams } from "./utils/page.js";
import { stationWindow } from "./utils/schedule.js";
import { fortnightWindow } from "./utils/standing.js";
import { startOfDay } from "./utils/time.js";

export interface PrefetchTideStationOptions {
  units?: Units;
  locale?: string;
  /** The instant the page opens on; defaults to the clock. */
  now?: number;
}

/**
 * Prefetch all queries that the `<TideStation>` component will make: the
 * station, its week's window, the fortnight of extremes its
 * Range tile ranks against, and its Nearby lists. Call this on the server,
 * then use `dehydrate(queryClient)` to pass the cache to the client via a
 * pre-hydrated QueryClient. Like `prefetchQuery`, it resolves when a request
 * fails and leaves that query in its error state.
 *
 * Pass either `units` directly or `locale` to derive units automatically.
 */
export async function prefetchTideStation(
  queryClient: QueryClient,
  baseUrl: string,
  id: string,
  { units, locale, now = Date.now() }: PrefetchTideStationOptions = {},
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: queryKeys.station(id),
    queryFn: () => fetchStation(baseUrl, id),
  });
  const station = queryClient.getQueryData<Station>(queryKeys.station(id));
  if (!station) return;

  // The page's own query builders, so the keys match what it reads.
  const config = { baseUrl, units: units ?? getDefaultUnits(locale) };
  const week = { id, ...stationWindow(startOfDay(now, station.timezone)) };
  const fortnight = { id, ...fortnightWindow(now, station.timezone) };
  const nearby = nearbyParams(station.latitude, station.longitude, PAGE_NEARBY_RESULTS, true);
  const predictions =
    station.predictions === false
      ? []
      : [
          queryClient.prefetchQuery(timelineQuery(config, week)),
          queryClient.prefetchQuery(extremesQuery(config, week)),
          queryClient.prefetchQuery(extremesQuery(config, fortnight)),
        ];

  await Promise.all([...predictions, prefetchNearby(queryClient, baseUrl, nearby)]);
}

export interface PrefetchNearbyStationsOptions {
  latitude: number;
  longitude: number;
  /** The listing's size; the default matches `<NearbyStations stationId={...}>`'s own. */
  maxResults?: number;
}

/** Prefetch the tide and current lists that `<NearbyStations stationId={...}>` will make. */
export async function prefetchNearbyStations(
  queryClient: QueryClient,
  baseUrl: string,
  {
    latitude,
    longitude,
    maxResults = nearbyParams(latitude, longitude, NEARBY_RESULTS, true).maxResults,
  }: PrefetchNearbyStationsOptions,
): Promise<void> {
  await prefetchNearby(queryClient, baseUrl, { latitude, longitude, maxResults });
}

function prefetchNearby(
  queryClient: QueryClient,
  baseUrl: string,
  params: { latitude: number; longitude: number; maxResults: number },
) {
  return Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.nearbyStations(params),
      queryFn: () => fetchStations(baseUrl, params),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.currentStations(params),
      queryFn: () => fetchCurrentStations(baseUrl, params),
    }),
  ]);
}
