import { getExtremesPrediction } from "slackwater";

const start = new Date();
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

const options = {
  latitude: 22.24,
  longitude: -75.75,
  start,
  end,
};

const inMeters = await getExtremesPrediction(options);
const inFeet = await getExtremesPrediction({ ...options, units: "feet" });

console.table(
  inMeters.extremes.map((extreme, i) => ({
    time: extreme.time,
    type: extreme.label,
    meters: Number(extreme.level.toFixed(2)),
    feet: Number(inFeet.extremes[i].level.toFixed(2)),
  })),
);
