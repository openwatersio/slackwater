import { useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig, type SlackwaterConfig } from "../provider.js";
import {
  fetchExtremes,
  fetchStationExtremes,
  type LocationParams,
  type StationPredictionParams,
  type PredictionParams,
} from "../client.js";
import { queryKeys } from "../query-keys.js";
import type { PredictionQueryOptions } from "./use-timeline.js";
import type { ExtremesResponse } from "../types.js";

/** No `datum`: every reader takes the API's default, the station's chart datum, so their queries match. */
export type UseExtremesParams =
  | ({ id: string } & Omit<PredictionParams, "datum">)
  | (Omit<LocationParams, "datum"> & { id?: undefined });

/** The extremes query for these params, so a map pin and a card share one cache entry. */
export function extremesQuery(
  { baseUrl, units }: Pick<SlackwaterConfig, "baseUrl" | "units">,
  params: UseExtremesParams,
) {
  const merged = { ...params, units: params.units ?? units };
  return {
    queryKey: queryKeys.extremes(merged),
    queryFn: (): Promise<ExtremesResponse> =>
      merged.id
        ? fetchStationExtremes(baseUrl, merged as StationPredictionParams)
        : fetchExtremes(baseUrl, merged as LocationParams),
  };
}

export function useExtremes(
  params: UseExtremesParams,
  options: PredictionQueryOptions<ExtremesResponse> = {},
) {
  return useQuery({ ...options, ...extremesQuery(useSlackwaterConfig(), params) });
}
