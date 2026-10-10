// Generate the currents parity fixture from the Slackwater JS reference
// (@slackwater/engine). Slackwater is the oracle: the Swift engine can gate
// against these values with the tide-parity tolerances in docs/CONTRACT.md.
// Constituents come from the NOAA golden fixtures so the parity set exercises
// a real station (PUG1741 harmonic; PCT0236's reduction off SFB1201).
// Usage: node fixtures/generate/gen-currents.mjs [--check]
import { createCurrentPredictor, createSubordinateCurrentPredictor } from "@slackwater/engine";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeJSON } from "./write.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
const iso = (d) => d.toISOString();

const start = new Date("2026-06-01T00:00:00Z");
const end = new Date("2026-06-03T00:00:00Z");
const span = { start, end };

const harmonic = read("currents-golden-harmonic.json");
const station = createCurrentPredictor(harmonic.constituents, {
  floodDirection: harmonic.floodDirection,
  ebbDirection: harmonic.ebbDirection,
  meanFlow: harmonic.offset,
});

const subordinate = read("currents-golden-subordinate.json");
const reference = createCurrentPredictor(subordinate.refConstituents, {
  floodDirection: subordinate.refFloodDirection,
  ebbDirection: subordinate.refEbbDirection,
  meanFlow: subordinate.refOffset,
});
const offsets = {
  slackBeforeFloodOffset: subordinate.slackBeforeFloodOffset,
  slackBeforeEbbOffset: subordinate.slackBeforeEbbOffset,
  floodTimeOffset: subordinate.floodTimeOffset,
  ebbTimeOffset: subordinate.ebbTimeOffset,
  floodSpeedRatio: subordinate.floodSpeedRatio,
  ebbSpeedRatio: subordinate.ebbSpeedRatio,
  floodDirection: subordinate.floodDirection,
  ebbDirection: subordinate.ebbDirection,
};
const reduced = createSubordinateCurrentPredictor(reference, offsets);

const timeline = (predictor) =>
  predictor
    .getTimelinePrediction(span)
    .map(({ time, speed }) => ({ time: iso(time), speed }));
const events = (predictor) =>
  predictor
    .getEventsPrediction(span)
    .map(({ time, speed, kind }) => ({ time: iso(time), speed, kind }));

writeJSON(join(FIX, "currents-parity.json"), {
  note: "Slackwater (TS) current predictions. Timeline 48h @ 600s, signed knots along the flood axis; events per UTC day. Subordinate offsets in seconds.",
  start: iso(start),
  end: iso(end),
  harmonic: {
    station: harmonic.station,
    floodDirection: harmonic.floodDirection,
    ebbDirection: harmonic.ebbDirection,
    offset: harmonic.offset,
    constituents: harmonic.constituents,
    timeline: timeline(station),
    events: events(station),
  },
  subordinate: {
    sub: subordinate.sub,
    reference: {
      floodDirection: subordinate.refFloodDirection,
      ebbDirection: subordinate.refEbbDirection,
      offset: subordinate.refOffset,
      constituents: subordinate.refConstituents,
    },
    ...offsets,
    timeline: timeline(reduced),
    events: events(reduced),
  },
});
