import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import type { StationsSearchParams } from "../client.js";
import type { StationSummary } from "../types.js";
import { queryKeys } from "../query-keys.js";

type StationsQueryOptions = Pick<UseQueryOptions<StationSummary[]>, "placeholderData" | "enabled">;

export function useStations(params: StationsSearchParams = {}, options: StationsQueryOptions = {}) {
  const { dataSource } = useSlackwaterConfig();

  return useQuery({
    queryKey: queryKeys.stations(params, dataSource.cacheKey),
    queryFn: () => dataSource.getStations(params),
    ...options,
  });
}
