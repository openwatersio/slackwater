import { type QueryClient } from "@tanstack/react-query";

import type { Station, Units } from "./types.js";
import { queryKeys } from "./query-keys.js";
import { resolveDataSource, type SlackwaterDataSource } from "./data-source.js";
import { extremesQuery } from "./hooks/use-extremes.js";
import { timelineQuery } from "./hooks/use-timeline.js";
import { getDefaultUnits } from "./utils/defaults.js";
import { NEARBY_RESULTS, PAGE_NEARBY_RESULTS, nearbyParams } from "./utils/page.js";
import { stationWindow } from "./utils/schedule.js";
import { fortnightWindow, outlookWindow } from "./utils/standing.js";
import { startOfDay } from "./utils/time.js";

export interface PrefetchTideStationOptions {
  units?: Units;
  locale?: string;
  /** The instant the page opens on; defaults to the clock. */
  now?: number;
}

/**
 * Prefetch the main queries for `<TideStation>`: the
 * station, its week's window, the fortnight of extremes its
 * Range tile ranks against, its outlook week, and its Nearby lists. Call this on the server,
 * then use `dehydrate(queryClient)` to pass the cache to the client via a
 * pre-hydrated QueryClient. Like `prefetchQuery`, it resolves when a request
 * fails and leaves that query in its error state.
 *
 * Pass either `units` directly or `locale` to derive units automatically.
 */
export async function prefetchTideStation(
  queryClient: QueryClient,
  input: string | SlackwaterDataSource,
  id: string,
  { units, locale, now = Date.now() }: PrefetchTideStationOptions = {},
): Promise<void> {
  const source = resolveDataSource(input);
  await queryClient.prefetchQuery({
    queryKey: queryKeys.station(id, source.cacheKey),
    queryFn: () => source.getStation(id),
  });
  const station = queryClient.getQueryData<Station>(queryKeys.station(id, source.cacheKey));
  if (!station) return;

  // The page's own query builders, so the keys match what it reads.
  const config = { dataSource: source, units: units ?? getDefaultUnits(locale) };
  const week = { id, ...stationWindow(startOfDay(now, station.timezone)) };
  const outlook = { id, ...outlookWindow(startOfDay(now, station.timezone), station.timezone) };
  const fortnight = { id, ...fortnightWindow(now, station.timezone) };
  const nearby = nearbyParams(station.latitude, station.longitude, PAGE_NEARBY_RESULTS, true);
  const predictions =
    station.predictions === false
      ? []
      : [
          queryClient.prefetchQuery(timelineQuery(config, week)),
          queryClient.prefetchQuery(extremesQuery(config, week)),
          queryClient.prefetchQuery(extremesQuery(config, fortnight)),
          queryClient.prefetchQuery(extremesQuery(config, outlook)),
        ];

  await Promise.all([...predictions, prefetchNearby(queryClient, source, nearby)]);
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
  input: string | SlackwaterDataSource,
  {
    latitude,
    longitude,
    maxResults = nearbyParams(latitude, longitude, NEARBY_RESULTS, true).maxResults,
  }: PrefetchNearbyStationsOptions,
): Promise<void> {
  await prefetchNearby(queryClient, resolveDataSource(input), { latitude, longitude, maxResults });
}

function prefetchNearby(
  queryClient: QueryClient,
  source: SlackwaterDataSource,
  params: { latitude: number; longitude: number; maxResults: number },
) {
  return Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.nearbyStations(params, source.cacheKey),
      queryFn: () => source.getStations(params),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.currentStations(params, source.cacheKey),
      queryFn: () => source.getCurrentStations(params),
    }),
  ]);
}
