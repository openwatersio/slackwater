import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
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

export function useTimeline(
  params: UseTimelineParams,
  options: PredictionQueryOptions<TimelineResponse> = {},
) {
  const { baseUrl, units, datum } = useSlackwaterConfig();
  const mergedUnits = params.units ?? units;
  const mergedDatum = params.datum ?? datum;

  return useQuery({
    ...options,
    queryKey: queryKeys.timeline({ ...params, units: mergedUnits, datum: mergedDatum }),
    queryFn: () => {
      if (params.id) {
        return fetchStationTimeline(baseUrl, {
          ...params,
          id: params.id,
          units: mergedUnits,
          datum: mergedDatum,
        } as StationPredictionParams);
      }
      return fetchTimeline(baseUrl, {
        ...(params as LocationParams),
        units: mergedUnits,
        datum: mergedDatum,
      });
    },
  });
}
