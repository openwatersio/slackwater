import { keepPreviousData, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import {
  fetchCurrentStations,
  fetchCurrentStation,
  fetchCurrentStationEvents,
  fetchCurrentStationTimeline,
  type StationsSearchParams,
} from "../client.js";
import { queryKeys } from "../query-keys.js";
import type { CurrentStationSummary } from "../types.js";

type CurrentStationsQueryOptions = Pick<
  UseQueryOptions<CurrentStationSummary[]>,
  "placeholderData" | "enabled"
>;

/** Search, list, or find current stations near a position. */
export function useCurrentStations(
  params: StationsSearchParams = {},
  options: CurrentStationsQueryOptions = {},
) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentStations(params),
    queryFn: () => fetchCurrentStations(baseUrl, params),
    ...options,
  });
}

export function useCurrentStation(id: string | undefined) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentStation(id),
    queryFn: () => fetchCurrentStation(baseUrl, id!),
    enabled: !!id,
  });
}

export interface CurrentPredictionRange {
  start: string;
  end: string;
}

export function useCurrentEvents(id: string, range: CurrentPredictionRange | undefined) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentEvents({ id, ...range }),
    queryFn: () => fetchCurrentStationEvents(baseUrl, { id, ...range }),
    enabled: !!range,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  });
}

/** The current timeline query for a station's window, so a map pin and a card share one cache entry. */
export function currentTimelineQuery(baseUrl: string, id: string, range?: CurrentPredictionRange) {
  return {
    queryKey: queryKeys.currentTimeline({ id, ...range }),
    queryFn: () => fetchCurrentStationTimeline(baseUrl, { id, ...range }),
  };
}

export function useCurrentTimeline(id: string, range: CurrentPredictionRange | undefined) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    ...currentTimelineQuery(baseUrl, id, range),
    enabled: !!range,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  });
}
