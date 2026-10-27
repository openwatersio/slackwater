import { bbox, type Filter } from "@slackwater/database";

/** The database index expects west <= east, so query each side of a crossing separately. */
export function stationsInBounds(bounds: Parameters<typeof bbox>[0], filter: Filter) {
  const [west, south, east, north] = bounds;
  if (west <= east) return bbox(bounds, { filter });

  return [
    ...bbox([west, south, 180, north], { filter }),
    ...bbox([-180, south, east, north], { filter }),
  ];
}
