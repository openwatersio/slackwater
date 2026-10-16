import { type QueryClient } from "@tanstack/react-query";

import type { Units } from "./types.js";
import { queryKeys } from "./query-keys.js";
import {
  fetchStation,
  fetchStationTimeline,
  fetchStationExtremes,
  fetchStations,
} from "./client.js";
import { getDefaultUnits } from "./utils/defaults.js";
import { stationWindow } from "./utils/schedule.js";
import { startOfDay } from "./utils/time.js";

export interface PrefetchTideStationOptions {
  units?: Units;
  locale?: string;
  /** The instant the page opens on; defaults to the clock. */
  now?: number;
}

/**
 * Prefetch all queries that the `<TideStation>` component will make: the
 * station, then its week's window at chart datum. Call this on the server,
 * then use `dehydrate(queryClient)` to pass the cache to the client via a
 * pre-hydrated QueryClient.
 *
 * Pass either `units` directly or `locale` to derive units automatically.
 */
export async function prefetchTideStation(
  queryClient: QueryClient,
  baseUrl: string,
  id: string,
  { units, locale, now = Date.now() }: PrefetchTideStationOptions = {},
): Promise<void> {
  const station = await queryClient.fetchQuery({
    queryKey: queryKeys.station(id),
    queryFn: () => fetchStation(baseUrl, id),
  });
  const params = {
    id,
    ...stationWindow(startOfDay(now, station.timezone)),
    datum: station.defaultDatum,
    units: units ?? getDefaultUnits(locale),
  };

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.timeline(params),
      queryFn: () => fetchStationTimeline(baseUrl, params),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.extremes(params),
      queryFn: () => fetchStationExtremes(baseUrl, params),
    }),
  ]);
}

export interface PrefetchNearbyStationsOptions {
  latitude: number;
  longitude: number;
  maxResults?: number;
}

/**
 * Prefetch the nearby-stations query that `<NearbyStations stationId={...}>` will make.
 * The default maxResults matches the component's internal default (5 + 1 for the
 * excluded current station).
 */
export async function prefetchNearbyStations(
  queryClient: QueryClient,
  baseUrl: string,
  { latitude, longitude, maxResults = 6 }: PrefetchNearbyStationsOptions,
): Promise<void> {
  const params = { latitude, longitude, maxResults };

  await queryClient.prefetchQuery({
    queryKey: queryKeys.nearbyStations(params),
    queryFn: () => fetchStations(baseUrl, params),
  });
}
