const ignoreSelection = () => {};

import { StationsMap } from "./StationsMap.js";
import type { CardStation } from "./StationCard.js";
import { nearbyBounds } from "../utils/page.js";

export default function NearbyMap({
  latitude,
  longitude,
  stations,
  focusStation,
  onStationSelect,
}: {
  latitude: number;
  longitude: number;
  stations: CardStation[];
  focusStation?: string;
  onStationSelect?: (station: CardStation) => void;
}) {
  return (
    <StationsMap
      initialViewState={{
        bounds: nearbyBounds(latitude, longitude, stations),
        fitBoundsOptions: { padding: 32, maxZoom: 12.5 },
      }}
      focusStation={focusStation}
      showGeolocation={false}
      showLegend={false}
      onPinSelect={onStationSelect ?? ignoreSelection}
      scrollZoom={false}
      cooperativeGestures
    />
  );
}
