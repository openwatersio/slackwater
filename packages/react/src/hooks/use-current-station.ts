import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import {
  fetchCurrentStation,
  fetchCurrentStationEvents,
  fetchCurrentStationTimeline,
} from "../client.js";
import { queryKeys } from "../query-keys.js";

export function useCurrentStation(id: string) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentStation(id),
    queryFn: () => fetchCurrentStation(baseUrl, id),
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

export function useCurrentTimeline(id: string, range: CurrentPredictionRange | undefined) {
  const { baseUrl } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentTimeline({ id, ...range }),
    queryFn: () => fetchCurrentStationTimeline(baseUrl, { id, ...range }),
    enabled: !!range,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  });
}
