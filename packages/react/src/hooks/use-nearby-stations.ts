import { useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import { queryKeys } from "../query-keys.js";

export interface UseNearbyStationsParams {
  latitude: number;
  longitude: number;
  maxResults?: number;
  maxDistance?: number;
}

export function useNearbyStations(params: UseNearbyStationsParams | undefined) {
  const { dataSource } = useSlackwaterConfig();

  return useQuery({
    queryKey: queryKeys.nearbyStations(params ?? {}, dataSource.cacheKey),
    queryFn: () => dataSource.getStations(params!),
    enabled: !!params,
  });
}
