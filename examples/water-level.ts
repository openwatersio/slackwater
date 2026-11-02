import { getWaterLevelAtTime } from "slackwater";

const prediction = await getWaterLevelAtTime({
  lat: 26.77,
  lon: -80.05,
  time: new Date("2025-12-19T00:30:00-05:00"),
  datum: "MSL",
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(prediction);
