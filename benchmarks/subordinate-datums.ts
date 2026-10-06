import { expect } from "vitest";
import { findStation } from "slackwater";
import { stations as db } from "@slackwater/database";

// NOAA ratio offsets apply above chart datum, so MSL must give the same tide once converted back.
const start = new Date("2026-10-06T00:00:00Z");
const end = new Date("2026-10-07T00:00:00Z");

const subordinates = db.filter(
  (station) => station.kind === "tide" && station.type === "subordinate",
);

let worst = { station: "", error: 0 };

for (const { id } of subordinates) {
  const station = findStation(id);
  const chart = station.defaultDatum;
  // A subordinate without a chart datum or MSL is a data error, not a station to skip.
  if (!chart || !("MSL" in station.datums)) throw new Error(`${id} has no chart datum or MSL`);

  const toChart = station.datums.MSL - station.datums[chart];
  const levels = (datum: string) => [
    ...station.getExtremesPrediction({ start, end, datum }).extremes.map((e) => e.level),
    ...station.getTimelinePrediction({ start, end, datum }).timeline.map((p) => p.level),
  ];

  const inChart = levels(chart);
  const inMSL = levels("MSL");
  for (let i = 0; i < inChart.length; i++) {
    const error = Math.abs(inMSL[i] + toChart - inChart[i]);
    if (error > worst.error) worst = { station: id, error };
  }
}

console.log(`MSL vs chart datum across ${subordinates.length} subordinates:`, worst);

expect(worst.error, `MSL vs chart datum at ${worst.station}`).toBeLessThan(1e-9);
