import { useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import {
  resolveDataSource,
  type SlackwaterDataSource,
  type TidePredictionParams,
} from "../data-source.js";
import type { Units } from "../types.js";
import { queryKeys } from "../query-keys.js";
import type { PredictionQueryOptions } from "./use-timeline.js";
import type { ExtremesResponse } from "../types.js";

/** No `datum`: every reader takes the API's default, the station's chart datum, so their queries match. */
export type UseExtremesParams = TidePredictionParams;

/** The extremes query for these params, so a map pin and a card share one cache entry. */
export function extremesQuery(
  {
    baseUrl,
    dataSource,
    units,
  }: { baseUrl?: string; dataSource?: SlackwaterDataSource; units: Units },
  params: UseExtremesParams,
) {
  const source = resolveDataSource(dataSource ?? baseUrl);
  const merged = { ...params, units: params.units ?? units };
  return {
    queryKey: queryKeys.extremes(merged, source.cacheKey),
    queryFn: (): Promise<ExtremesResponse> => source.getExtremes(merged),
  };
}

export function useExtremes(
  params: UseExtremesParams,
  options: PredictionQueryOptions<ExtremesResponse> = {},
) {
  return useQuery({ ...options, ...extremesQuery(useSlackwaterConfig(), params) });
}
