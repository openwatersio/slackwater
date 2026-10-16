import { useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
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

export type UseExtremesParams =
  ({ id: string } & PredictionParams) | (LocationParams & { id?: undefined });

export function useExtremes(
  params: UseExtremesParams,
  options: PredictionQueryOptions<ExtremesResponse> = {},
) {
  const { baseUrl, units, datum } = useSlackwaterConfig();
  const mergedUnits = params.units ?? units;
  const mergedDatum = params.datum ?? datum;

  return useQuery({
    ...options,
    queryKey: queryKeys.extremes({ ...params, units: mergedUnits, datum: mergedDatum }),
    queryFn: () => {
      if (params.id) {
        return fetchStationExtremes(baseUrl, {
          ...params,
          id: params.id,
          units: mergedUnits,
          datum: mergedDatum,
        } as StationPredictionParams);
      }
      return fetchExtremes(baseUrl, {
        ...(params as LocationParams),
        units: mergedUnits,
        datum: mergedDatum,
      });
    },
  });
}
