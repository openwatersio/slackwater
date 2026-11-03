import { useQuery } from "@tanstack/react-query";
import { useSlackwaterConfig } from "../provider.js";
import { queryKeys } from "../query-keys.js";

export function useStation(id: string | undefined) {
  const { dataSource } = useSlackwaterConfig();

  return useQuery({
    queryKey: queryKeys.station(id, dataSource.cacheKey),
    queryFn: () => dataSource.getStation(id!),
    enabled: !!id,
  });
}
