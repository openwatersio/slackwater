// Caller-supplied constituent definitions, predicted and fitted by @slackwater/engine,
// so the Swift and Kotlin engines can check they build and reject definitions the same way.
import { fileURLToPath } from "node:url";
import { constituents, createTidePredictor, fit } from "@slackwater/engine";
import { writeJSON } from "./write.mjs";

const definition = (name, line, changes = {}) => ({
  name,
  speed: constituents[line].speed,
  coefficients: constituents[line].coefficients,
  ...changes,
});
// The argument's seventh coefficient counts 90° steps; adding one moves the line's phase by 90°.
const shifted = (line, steps) => {
  const coefficients = [...constituents[line].coefficients];
  coefficients[6] += steps;
  return coefficients;
};
const span = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-04T00:00:00.000Z", step: 3600 };

const predictions = [
  {
    name: "adds a constituent the catalog doesn't have",
    definitions: [definition("M2_COPY", "M2", { members: [["M2", 1]] })],
    constituents: [
      { name: "M2_COPY", amplitude: 1, phase: 30 },
      { name: "K1", amplitude: 0.3, phase: 100 },
    ],
  },
  {
    name: "replaces M2 without moving MS4",
    definitions: [definition("M2", "M2", { coefficients: shifted("M2", 1) })],
    constituents: [
      { name: "M2", amplitude: 1, phase: 30 },
      { name: "MS4", amplitude: 0.2, phase: 10 },
    ],
  },
  {
    name: "replaces nu2 under all its names",
    definitions: [definition("NU2", "nu2", { coefficients: shifted("nu2", 2), members: [["M2", 1]] })],
    constituents: [{ name: "nu2", amplitude: 0.2, phase: 40 }],
  },
  {
    name: "keeps Mf's correction formula under MF",
    definitions: [definition("MF", "Mf")],
    constituents: [{ name: "Mf", amplitude: 0.1, phase: 40 }],
  },
  {
    name: "keeps M1's formula for an argument without p",
    definitions: [definition("M1", "M1C", { coefficients: shifted("M1C", -1) })],
    constituents: [{ name: "M1", amplitude: 0.3, phase: 120 }],
  },
  {
    name: "counts p in an M1 argument built from members",
    definitions: [{ name: "M1", speed: constituents.M1C.speed, coefficients: null, members: [["M1C", 1]] }],
    constituents: [{ name: "M1", amplitude: 0.3, phase: 120 }],
  },
  {
    name: "half of M1's correction doesn't jump when M1's u wraps",
    definitions: [definition("HALF_M1", "M1C", { members: [["M1", 0.5]] })],
    constituents: [{ name: "HALF_M1", amplitude: 0.3, phase: 120 }],
    start: "2024-06-27T00:00:00.000Z",
    end: "2024-07-02T00:00:00.000Z",
  },
  {
    name: "builds a compound's argument from members defined later",
    definitions: [
      {
        name: "A",
        speed: 2 * constituents.M2.speed,
        coefficients: null,
        members: [["B", 2]],
      },
      definition("B", "M2", { aliases: ["B", "b"], members: [["M2", 1]] }),
    ],
    constituents: [
      { name: "A", amplitude: 0.2, phase: 10 },
      { name: "b", amplitude: 0.5, phase: 70 },
    ],
  },
].map((entry) => {
  const predictor = createTidePredictor(entry.constituents, { definitions: entry.definitions });
  const window = { ...span, ...entry };
  const [start, end] = [new Date(window.start), new Date(window.end)];
  return {
    ...window,
    heights: predictor
      .getTimelinePrediction({ start, end, timeFidelity: window.step })
      .map((point) => point.level),
    extremes: predictor
      .getExtremesPrediction({ start, end })
      .map(({ time, level, high }) => ({ time: time.toISOString(), level, high })),
  };
});

const truth = predictions[0];
const samples = Array.from({ length: 24 * 30 }, (_, h) => {
  const time = new Date(Date.UTC(2026, 0, 1, h));
  const value = createTidePredictor(truth.constituents, { definitions: truth.definitions })
    .getWaterLevelAtTime({ time }).level;
  return { time: time.toISOString(), value };
});
const basis = ["M2_COPY", "K1"];
const fitted = fit(
  samples.map(({ time, value }) => ({ time: new Date(time), value })),
  basis,
  { definitions: truth.definitions },
);

const errors = [
  { name: "a null speed", definitions: [{ name: "A", speed: null, coefficients: null }] },
  { name: "an empty name", definitions: [definition("", "M2")] },
  { name: "six coefficients", definitions: [definition("A", "M2", { coefficients: [2, 0, 0, 0, 0, 0] })] },
  { name: "a fractional coefficient", definitions: [definition("A", "M2", { coefficients: [2, 0, 0, 0, 0, 0, 0.5] })] },
  { name: "a speed off its argument", definitions: [definition("A", "M2", { speed: 28.9 })] },
  {
    name: "a negative speed",
    definitions: [
      definition("A", "M2", {
        speed: -constituents.M2.speed,
        coefficients: constituents.M2.coefficients.map((k) => -k),
      }),
    ],
  },
  { name: "a replacement for Z0", definitions: [{ name: "Z0", speed: 0, coefficients: [0, 0, 0, 0, 0, 0, 1] }] },
  { name: "no coefficients or members", definitions: [{ name: "A", speed: 1, coefficients: null }] },
  { name: "names two catalog entries", definitions: [definition("X", "M2", { aliases: ["M2", "N2"] })] },
  { name: "a name defined twice", definitions: [definition("A", "M2"), definition("A", "M2")] },
  { name: "two definitions for one entry", definitions: [definition("NU2", "nu2"), definition("nu2", "nu2")] },
  { name: "an unknown member", definitions: [definition("A", "M2", { members: [["NOPE", 1]] })] },
  { name: "a member of itself", definitions: [definition("N2", "N2", { members: [["N2", 1]] })] },
  {
    name: "a member cycle",
    definitions: [
      { name: "A", speed: constituents.M2.speed, coefficients: null, members: [["B", 1]] },
      definition("B", "M2", { members: [["A", 1]] }),
    ],
  },
].map((entry) => {
  try {
    createTidePredictor([], { definitions: entry.definitions });
  } catch (error) {
    return { ...entry, error: error.message.split(":")[0] };
  }
  throw new Error(`accepted: ${entry.name}`);
});

writeJSON(fileURLToPath(new URL("../constituent-definitions.json", import.meta.url)), {
  note: "Generated by fixtures/generate/gen-definitions.mjs from @slackwater/engine.",
  predictions,
  // offset and rms are float noise on noise-free samples, and differ by platform.
  fit: { definitions: truth.definitions, basis, samples, expected: { constituents: fitted.constituents } },
  errors,
});
