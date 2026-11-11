// Generate the shared-readings parity fixture from the Slackwater JS reference
// (@slackwater/engine). Slackwater is the oracle: the Swift and Kotlin ports
// check their readings (state, interpolation, slack windows, flow peaks, swing
// ranks) against these values.
// Usage: node fixtures/generate/gen-readings.mjs [--check]
import {
  createCurrentPredictor,
  createTidePredictor,
  flowPeaks,
  peakRank,
  readCurrent,
  readTide,
  slackRuns,
  slackWindowAround,
  swingHeights,
  tideRates,
} from "@slackwater/engine";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeJSON } from "./write.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
const iso = (d) => d.toISOString();

const HOUR = 3_600_000;
const start = new Date("2026-06-01T00:00:00Z");
const end = new Date("2026-06-03T00:00:00Z");
const timeFidelity = 600;
const span = { start, end, timeFidelity };

/** Every whole hour from start to end, inclusive. */
const hours = [];
for (let t = start.getTime(); t <= end.getTime(); t += HOUR) hours.push(t);

/** Distinct instants in ascending order, as dates. */
const instants = (times) => [...new Set(times)].sort((a, b) => a - b).map((t) => new Date(t));

// Vector series: PUG1741 major constituents plus synthetic minor-axis constants.
const harmonic = read("currents-golden-harmonic.json");
const vectorInputs = {
  constituents: harmonic.constituents,
  minorConstituents: [
    { name: "M2", amplitude: 0.7, phase: 90 },
    { name: "K1", amplitude: 0.2, phase: 210 },
  ],
  meanFlow: 0.3,
  minorMeanFlow: -0.15,
  floodDirection: 20,
  ebbDirection: 205,
  azimuth: 350,
};
const threshold = 0.5;
const directions = { flood: vectorInputs.floodDirection, ebb: vectorInputs.ebbDirection };
const station = createCurrentPredictor(vectorInputs.constituents, vectorInputs);
const vectorTimeline = station.getTimelinePrediction(span);
const vectorEvents = station.getEventsPrediction(span);

const vectorInstants = instants([
  ...hours,
  ...vectorEvents.flatMap((e) => [e.time.getTime() - 1000, e.time.getTime() + 1000]),
]);
const vectorReadings = vectorInstants.flatMap((time) => {
  const reading = readCurrent(time, vectorTimeline, vectorEvents, directions);
  return reading ? [{ time: iso(time), ...reading }] : [];
});

const windows = vectorEvents
  .filter((e) => e.kind === "slack")
  .flatMap((e) => {
    const window = slackWindowAround(vectorTimeline, e.time, threshold);
    return window ? [{ slack: iso(e.time), start: iso(window.start), end: iso(window.end) }] : [];
  });
const runs = slackRuns(vectorTimeline, vectorEvents, threshold).map((r) => ({
  start: iso(r.start),
  end: iso(r.end),
}));

// Scalar series: a hand-built major-axis series with no vector fields, so
// directions come from the flood and ebb set alone.
const scalarBase = new Date("2026-06-01T00:00:00Z").getTime();
const at = (h) => new Date(scalarBase + h * HOUR);
const scalarDirections = { flood: 45, ebb: 200 };
const scalarTimeline = [
  { time: at(0), speed: 0.3 },
  { time: at(1), speed: -0.3 },
  { time: at(2), speed: 0.3 },
  { time: at(3), speed: 0.01 },
  { time: at(4), speed: -0.01 },
];
const scalarEvents = [
  { time: at(0.5), speed: 0, kind: "slack" },
  { time: at(3), speed: 0.01, kind: "minFlood" },
  { time: at(4), speed: -0.01, kind: "minEbb" },
];
const scalarReadings = [0.4, 0.5, 0.6, 1, 3, 4].flatMap((h) => {
  const reading = readCurrent(at(h), scalarTimeline, scalarEvents, scalarDirections);
  return reading ? [{ time: iso(at(h)), ...reading }] : [];
});

// Tide: the Victoria constituents in metres.
const victoria = read("prediction-victoria.json");
const predictor = createTidePredictor(victoria.constituents);
const tideTimeline = predictor.getTimelinePrediction(span);
const tideExtremes = predictor.getExtremesPrediction({ start, end });
const rates = tideRates(tideTimeline, "meters");
const peaks = flowPeaks(rates, 0.6);
const swings = swingHeights(tideExtremes);

const tideInstants = instants([...hours, ...tideExtremes.map((e) => e.time.getTime())]);
const tideReadings = tideInstants.flatMap((time) => {
  const reading = readTide(time, tideTimeline, rates, tideExtremes);
  return reading ? [{ time: iso(time), ...reading }] : [];
});

writeJSON(join(FIX, "readings.json"), {
  note: "Slackwater (TS) readings: current states, slack windows and runs, tide states, flow peaks and swing ranks over two days; the Swift and Kotlin ports check parity against these.",
  vector: {
    start: iso(start),
    end: iso(end),
    timeFidelity,
    ...vectorInputs,
    timeline: vectorTimeline.map(({ time, speed, magnitude, direction }) => ({
      time: iso(time),
      speed,
      magnitude,
      direction,
    })),
    events: vectorEvents.map(({ time, speed, kind }) => ({ time: iso(time), speed, kind })),
    threshold,
    runs,
    windows,
    readings: vectorReadings,
  },
  scalar: {
    flood: scalarDirections.flood,
    ebb: scalarDirections.ebb,
    timeline: scalarTimeline.map(({ time, speed }) => ({ time: iso(time), speed })),
    events: scalarEvents.map(({ time, speed, kind }) => ({ time: iso(time), speed, kind })),
    readings: scalarReadings,
  },
  tide: {
    start: iso(start),
    end: iso(end),
    timeFidelity,
    constituents: victoria.constituents,
    timeline: tideTimeline.map(({ time, level }) => ({ time: iso(time), level })),
    extremes: tideExtremes.map(({ time, level, high }) => ({ time: iso(time), level, high })),
    rates: rates.map(({ time, rate }) => ({ time: iso(time), rate })),
    peaks: peaks.map(({ time, rate }) => ({ time: iso(time), rate })),
    readings: tideReadings,
    swings,
    ranks: swings.map((value) => ({ value, rank: peakRank(value, swings) })),
  },
});
