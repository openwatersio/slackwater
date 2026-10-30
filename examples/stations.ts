import { nearestStation, stationsNear, findStation } from "slackwater";

const station = await nearestStation({ lat: 26.7, lon: -80.05 });
console.log("Nearest station to 26.7, -80.05:", `${station.name} (${station.source.id})`);

console.log(
  "\n5 closest stations to 45.6, -122.7:",
  ...(await stationsNear({ latitude: 45.6, longitude: -122.7, maxResults: 5 })).map(
    (s) => `\n- ${s.name} (${s.source.id}) - ${(s.distance! / 1000).toFixed(2)} km away`,
  ),
);

// Find station by Slackwater ID
await findStation("noaa/8443970"); // Boston

// Find station by source ID (e.g. NOAA)
await findStation("9440083"); // Vancouver
