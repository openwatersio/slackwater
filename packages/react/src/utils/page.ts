/** How many stations `<NearbyStations>` lists by default. */
export const NEARBY_RESULTS = 5;
/** How many stations a station page's Nearby section lists. */
export const PAGE_NEARBY_RESULTS = 6;

/** The nearby listings' params: one more than shown when the list leaves out the station it is about. */
export function nearbyParams(
  latitude: number,
  longitude: number,
  maxResults: number,
  excluding: boolean,
) {
  return { latitude, longitude, maxResults: excluding ? maxResults + 1 : maxResults };
}
