/** How many stations `<NearbyStations>` lists by default. */
export const NEARBY_RESULTS = 5;
/** How many stations a station page's Nearby section lists. */
export const PAGE_NEARBY_RESULTS = 3;

/** The nearby listings' params: one more than shown when the list leaves out the station it is about. */
export function nearbyParams(
  latitude: number,
  longitude: number,
  maxResults: number,
  excluding: boolean,
) {
  return { latitude, longitude, maxResults: excluding ? maxResults + 1 : maxResults };
}

export function nearbyBounds(
  latitude: number,
  longitude: number,
  stations: { latitude: number; longitude: number }[],
): [[number, number], [number, number]] {
  const latitudes = [latitude, ...stations.map((s) => s.latitude)];
  const longitudes = [
    longitude,
    ...stations.map((s) => longitude + ((s.longitude - longitude + 540) % 360) - 180),
  ];
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
