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

/** No `datum`: every reader takes the API's default, the station's chart datum, so their queries match. */
export type UseTimelineParams =
  | ({ id: string } & Omit<PredictionParams, "datum">)
  | (Omit<LocationParams, "datum"> & { id?: undefined });

/** Query options a caller may set: when to fetch, and what to show while a new window loads. */
export type PredictionQueryOptions<T> = Pick<
  UseQueryOptions<T>,
  "enabled" | "placeholderData" | "staleTime"
>;

/** The timeline query for these params, so a map pin and a card share one cache entry. */
export function timelineQuery(
  { baseUrl, units }: Pick<SlackwaterConfig, "baseUrl" | "units">,
  params: UseTimelineParams,
) {
  const merged = { ...params, units: params.units ?? units };
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
