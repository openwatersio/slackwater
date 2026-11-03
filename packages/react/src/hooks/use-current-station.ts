import { keepPreviousData, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import type { StationsSearchParams } from "../client.js";
import { resolveDataSource, type SlackwaterDataSource } from "../data-source.js";
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
  const { dataSource } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentStations(params, dataSource.cacheKey),
    queryFn: () => dataSource.getCurrentStations(params),
    ...options,
  });
}

export function useCurrentStation(id: string | undefined) {
  const { dataSource } = useSlackwaterConfig();
  return useQuery({
    queryKey: queryKeys.currentStation(id, dataSource.cacheKey),
    queryFn: () => dataSource.getCurrentStation(id!),
    enabled: !!id,
  });
}

export interface CurrentPredictionRange {
  start: string;
  end: string;
}

export function useCurrentEvents(id: string, range: CurrentPredictionRange | undefined) {
  const { dataSource } = useSlackwaterConfig();
  return useQuery({
    ...currentEventsQuery(dataSource, id, range),
    enabled: !!range,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  });
}

/** The events shared by map pins and their station cards. */
export function currentEventsQuery(
  input: string | SlackwaterDataSource,
  id: string,
  range?: CurrentPredictionRange,
) {
  const source = resolveDataSource(input);
  return {
    queryKey: queryKeys.currentEvents({ id, ...range }, source.cacheKey),
    queryFn: () => source.getCurrentEvents({ id, ...range }),
  };
}

/** The current timeline query for a station's window, so a map pin and a card share one cache entry. */
export function currentTimelineQuery(
  input: string | SlackwaterDataSource,
  id: string,
  range?: CurrentPredictionRange,
) {
  const source = resolveDataSource(input);
  return {
    queryKey: queryKeys.currentTimeline({ id, ...range }, source.cacheKey),
    queryFn: () => source.getCurrentTimeline({ id, ...range }),
  };
}

export function useCurrentTimeline(id: string, range: CurrentPredictionRange | undefined) {
  const { dataSource } = useSlackwaterConfig();
  return useQuery({
    ...currentTimelineQuery(dataSource, id, range),
    enabled: !!range,
    // Predictions for a fixed window never change, and refetching would rebuild the strip.
    staleTime: Infinity,
    // A moved window keeps showing the old one until the new one loads.
    placeholderData: keepPreviousData,
  });
}
