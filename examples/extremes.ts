import { getExtremesPrediction } from "slackwater";

const prediction = await getExtremesPrediction({
  latitude: 26.7, // or `lat`
  longitude: -80.05, // or `lng` or `lon`
  start: new Date("2025-12-17"),
  end: new Date("2025-12-18"),
  datum: "MLLW", // optional, defaults to station's chart datum (usually LAT or MLLW)
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(prediction);
