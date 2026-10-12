import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeJSON } from "./write.mjs";

// Integer convolution is independent of the implementations' three running means.
export const godinWeights = [24, 24, 25].reduce(
  (weights, width) => {
    const next = Array(weights.length + width - 1).fill(0);
    weights.forEach((value, i) => {
      for (let j = 0; j < width; j++) next[i + j] += value;
    });
    return next;
  },
  [1],
);

export function oracleFilter(samples) {
  const output = [];
  for (let i = 35; i < samples.length - 35; i++) {
    if (samples[i + 35].time - samples[i - 35].time !== 70 * 3600000) continue;
    const value =
      godinWeights.reduce((sum, weight, j) => sum + weight * samples[i - 35 + j].value, 0) / 14400;
    output.push({ time: samples[i].time, value });
  }
  return output;
}

function oracleTrend(samples) {
  const window = samples.slice(-25);
  if (window.length < 25 || window[24].time - window[0].time !== 24 * 3600000) return null;
  const mean = window.reduce((sum, sample) => sum + sample.value, 0) / 25;
  const covariance = window.reduce((sum, sample, i) => sum + (i - 12) * (sample.value - mean), 0);
  const variance = window.reduce((sum, _, i) => sum + (i - 12) ** 2, 0);
  const slopePerHour = covariance / variance;
  return {
    time: window[24].time,
    slopePerHour,
    direction:
      Math.abs(slopePerHour * 24) <= 0.01 + 1e-12
        ? "steady"
        : slopePerHour > 0
          ? "rising"
          : "falling",
  };
}

export function generate(path, check) {
  const hourly = (count, value) =>
    Array.from({ length: count }, (_, i) => ({
      time: Date.parse("2025-10-31T00:30:00.123Z") + i * 3600000,
      value: value(i),
    }));
  const capture = JSON.parse(
    readFileSync(new URL("../residuals-noaa-friday-harbor.json", import.meta.url)),
  );
  const readings = capture.response.data.flatMap((row, i) => {
    if (
      !row.t.endsWith(":00") ||
      row.v.trim() === "" ||
      !Number.isFinite(Number(row.v)) ||
      row.q !== "v" ||
      row.f !== "0,0,0,0"
    )
      return [];
    return [
      {
        time: Date.parse(capture.predictions[i].time),
        observed: Number(row.v),
        predicted: capture.predictions[i].value,
      },
    ];
  });
  const cases = [
    { name: "constant", samples: hourly(97, () => 0.15) },
    { name: "ramp", samples: hourly(97, (i) => 0.1 + i * 0.002) },
    {
      name: "oscillation",
      samples: hourly(
        145,
        (i) =>
          0.2 + 0.4 * Math.sin((2 * Math.PI * i) / 24) + 0.3 * Math.cos((2 * Math.PI * i) / 12.42),
      ),
    },
    { name: "step", samples: hourly(145, (i) => (i < 72 ? -0.1 : 0.3)) },
    { name: "split-gap", samples: hourly(145, (i) => 0.1 + i * 0.002).filter((_, i) => i !== 72) },
    {
      name: "noaa-friday-harbor",
      readings,
      samples: readings.map(({ time, observed, predicted }) => ({
        time,
        value: observed - predicted,
      })),
    },
  ].map((entry) => {
    const filtered = oracleFilter(entry.samples);
    return { ...entry, filtered, trend: oracleTrend(filtered) };
  });
  writeJSON(
    path,
    {
      source:
        "Independent integer 24*24*25 convolution and centered two-pass regression; NOAA capture inputs remain fixed and offline.",
      valueTolerance: 1e-9,
      slopeTolerance: 1e-10,
      cases,
    },
    check,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate(
    fileURLToPath(new URL("../residuals-parity.json", import.meta.url)),
    process.argv.includes("--check"),
  );
}
