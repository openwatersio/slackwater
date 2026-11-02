import { getTimelinePrediction } from "slackwater";

const timeline = await getTimelinePrediction({
  lat: 26.77,
  lon: -80.05,
  start: new Date("2025-12-19T00:00:00-05:00"),
  end: new Date("2025-12-19T01:00:00-05:00"),
  timeFidelity: 5 * 60, // seconds, defaults to `10 * 60`
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(timeline);
