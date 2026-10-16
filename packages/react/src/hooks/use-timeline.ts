import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig, type SlackwaterConfig } from "../provider.js";
import {
  fetchTimeline,
  fetchStationTimeline,
  type LocationParams,
  type StationPredictionParams,
  type PredictionParams,
} from "../client.js";
import { queryKeys } from "../query-keys.js";
import type { TimelineResponse } from "../types.js";

export type UseTimelineParams =
  ({ id: string } & PredictionParams) | (LocationParams & { id?: undefined });

/** Query options a caller may set: when to fetch, and what to show while a new window loads. */
export type PredictionQueryOptions<T> = Pick<
  UseQueryOptions<T>,
  "enabled" | "placeholderData" | "staleTime"
>;

/** The timeline query for these params, so a map pin and a card share one cache entry. */
export function timelineQuery(
  { baseUrl, units, datum }: Pick<SlackwaterConfig, "baseUrl" | "units" | "datum">,
  params: UseTimelineParams,
) {
  const merged = { ...params, units: params.units ?? units, datum: params.datum ?? datum };
  return {
    queryKey: queryKeys.timeline(merged),
    queryFn: (): Promise<TimelineResponse> =>
      merged.id
        ? fetchStationTimeline(baseUrl, merged as StationPredictionParams)
        : fetchTimeline(baseUrl, merged as LocationParams),
  };
}

export function useTimeline(
  params: UseTimelineParams,
  options: PredictionQueryOptions<TimelineResponse> = {},
) {
  return useQuery({ ...options, ...timelineQuery(useSlackwaterConfig(), params) });
}
