import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import {
  resolveDataSource,
  type SlackwaterDataSource,
  type TidePredictionParams,
} from "../data-source.js";
import type { Units } from "../types.js";
import { queryKeys } from "../query-keys.js";
import type { TimelineResponse } from "../types.js";

/** No `datum`: every reader takes the API's default, the station's chart datum, so their queries match. */
export type UseTimelineParams = TidePredictionParams;

/** Query options a caller may set: when to fetch, and what to show while a new window loads. */
export type PredictionQueryOptions<T> = Pick<
  UseQueryOptions<T>,
  "enabled" | "placeholderData" | "staleTime"
>;

/** The timeline query for these params, so a map pin and a card share one cache entry. */
export function timelineQuery(
  {
    baseUrl,
    dataSource,
    units,
  }: { baseUrl?: string; dataSource?: SlackwaterDataSource; units: Units },
  params: UseTimelineParams,
) {
  const source = resolveDataSource(dataSource ?? baseUrl);
  const merged = { ...params, units: params.units ?? units };
  return {
    queryKey: queryKeys.timeline(merged, source.cacheKey),
    queryFn: (): Promise<TimelineResponse> => source.getTimeline(merged),
  };
}

export function useTimeline(
  params: UseTimelineParams,
  options: PredictionQueryOptions<TimelineResponse> = {},
) {
  return useQuery({ ...options, ...timelineQuery(useSlackwaterConfig(), params) });
}
