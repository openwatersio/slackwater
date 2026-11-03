// Generate the CHS current recipe's golden fit and stamp
// (fixtures/chs-current-golden.json) from the @slackwater/engine reference.
// The stamp hashes the recipe's data with a fingerprint of what the recipe
// predicts for a fixed synthetic gate over one held-out week: each window's
// signed velocity every 10 minutes, its slack times, and its max flood and max
// ebb times and signed speeds. A change to the basis, windows, sample step,
// projection, `fit` or `createCurrentPredictor` that moves a golden velocity by
// VELOCITY_TOLERANCE_KN (0.0001 kn) or more, a slack or peak by TIME_TOLERANCE_MS
// (30 seconds) or more, or a peak's speed by SPEED_TOLERANCE_KN (0.001 kn) or
// more changes the stamp, and every engine's `ChsCurrentFit` stamp must change
// with it. Validation results and fitted models record the stamp, so a model
// never borrows the evidence of another recipe. The velocities catch a uniform
// speed scaling, which moves no slack, and the extrema catch a change to the
// current-extrema finder.
//
// The gate's directions swing off the flood axis by up to 20 degrees, with the
// speed scaled so that the projection recovers the synthetic velocity. Every
// fit therefore runs through `projectChsCurrent` off the axis, and the golden
// fingerprints the projection as the apps use it. The projection test cases in
// fixtures/chs-current-fit.json stay out of the hash: they are tests, and adding
// one must not change the stamp.
//
// A change that stays inside those tolerances keeps the recorded golden fit and
// its stamp, so engine releases that leave the recipe alone keep the stamp. The
// generator keeps the existing fixture, recorded windows and stamp included,
// while the series and event range are unchanged, every window's days and its
// velocity, slack and extremum counts and extremum kinds are unchanged, every
// recorded value is within its tolerance of the freshly computed one, and the
// recorded windows still hash to the recorded stamp (which fails when the
// recipe data changed). Otherwise it writes the fresh windows with their new
// stamp, and `--check` reports drift. Hashing rounded values would not do: a
// value a hair from a rounding boundary would flip the stamp on a harmless
// numeric change.
// Usage: node fixtures/generate/gen-chs-current-golden.mjs [--check]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { chsCurrentFit, createCurrentPredictor, fit, projectChsCurrent } from "@slackwater/engine";
import { writeJSON } from "./write.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VELOCITY_TOLERANCE_KN = 1e-4;
const TIME_TOLERANCE_MS = 30_000;
const SPEED_TOLERANCE_KN = 1e-3;

// Plain cosines in hours since `start`, so the input never depends on the
// engine's astronomy: tide-like lines, plus one at 28.006 h that the basis
// lacks, so the fit leaves a residual as it does on real data.
const series = {
  start: "2026-01-01T00:00:00Z",
  days: 210,
  floodDirection: 135,
  meanFlow: 0.1,
  offAxis: { amplitudeDegrees: 20, periodHours: 37.3 },
  components: [
    { periodHours: 12.4206012, amplitude: 2, phaseDegrees: 30 },
    { periodHours: 12, amplitude: 0.6, phaseDegrees: 75 },
    { periodHours: 12.65834751, amplitude: 0.4, phaseDegrees: 140 },
    { periodHours: 23.93446966, amplitude: 0.9, phaseDegrees: 200 },
    { periodHours: 25.81934171, amplitude: 0.7, phaseDegrees: 260 },
    { periodHours: 24.06589016, amplitude: 0.3, phaseDegrees: 310 },
    { periodHours: 6.210300601, amplitude: 0.15, phaseDegrees: 10 },
    { periodHours: 28.00621204, amplitude: 0.05, phaseDegrees: 95 },
  ],
};

const start = Date.parse(series.start);
const fitEnd = start + series.days * DAY;
const step = chsCurrentFit.sampleMinutes * 60_000;
const ebbDirection = (series.floodDirection + 180) % 360;
const speeds = [];
const directions = [];
for (let t = start; t <= fitEnd; t += step) {
  const hours = (t - start) / HOUR;
  const velocity = series.components.reduce(
    (sum, c) =>
      sum + c.amplitude * Math.cos((2 * Math.PI * hours) / c.periodHours - (c.phaseDegrees * Math.PI) / 180),
    series.meanFlow,
  );
  // IWLS reports a speed and the direction the water sets toward. The
  // direction leans `theta` off the axis, and the speed grows to keep the
  // projected velocity.
  const theta = series.offAxis.amplitudeDegrees * Math.sin((2 * Math.PI * hours) / series.offAxis.periodHours);
  const direction = (velocity >= 0 ? series.floodDirection : series.floodDirection + 180) + theta;
  speeds.push({ time: new Date(t), value: Math.abs(velocity) / Math.cos((theta * Math.PI) / 180) });
  directions.push({ time: new Date(t), value: ((direction % 360) + 360) % 360 });
}
const samples = projectChsCurrent(speeds, directions, series.floodDirection);
const from = new Date(fitEnd);
const to = new Date(fitEnd + 7 * DAY);
const events = { start: from.toISOString(), end: to.toISOString() };

const windows = chsCurrentFit.days.map((days) => {
  const result = fit(
    samples.filter((s) => s.time.getTime() >= fitEnd - days * DAY),
    chsCurrentFit.basis,
  );
  const predictor = createCurrentPredictor(result.constituents, {
    floodDirection: series.floodDirection,
    ebbDirection,
    meanFlow: result.offset,
  });
  const velocities = predictor
    .getTimelinePrediction({ start: from, end: to, timeFidelity: 600 })
    .map((p) => p.speed);
  const predicted = predictor
    .getEventsPrediction({ start: from, end: to })
    .filter((e) => e.time >= from && e.time < to);
  const slacks = predicted.filter((e) => e.kind === "slack").map((e) => e.time.toISOString());
  const extrema = predicted
    .filter((e) => e.kind !== "slack")
    .map(({ time, kind, speed }) => ({ time: time.toISOString(), kind, speed }));
  assert.ok(slacks.length >= 20, `${days}-day window predicts only ${slacks.length} slacks`);
  assert.ok(extrema.length >= 20, `${days}-day window predicts only ${extrema.length} extrema`);
  return {
    days,
    offset: result.offset,
    constituents: result.constituents.map(({ name, amplitude, phase }) => ({ name, amplitude, phase })),
    velocities,
    slacks,
    extrema,
  };
});

// `provisionalSlackMaxMinutes` is left out on purpose: it is a publication
// threshold, not a fit input, so changing it changes no fitted model.
const stampOf = (golden) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        speedSeries: chsCurrentFit.speedSeries,
        directionSeries: chsCurrentFit.directionSeries,
        basis: chsCurrentFit.basis,
        days: chsCurrentFit.days,
        sampleMinutes: chsCurrentFit.sampleMinutes,
        windows: golden.map(({ days, velocities, slacks, extrema }) => ({ days, velocities, slacks, extrema })),
      }),
    )
    .digest("hex")
    .slice(0, 12);

const path = fileURLToPath(new URL("../chs-current-golden.json", import.meta.url));
const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;

const within = (a, b, tolerance) => Math.abs(a - b) < tolerance;
const sameTime = (a, b) => within(Date.parse(a), Date.parse(b), TIME_TOLERANCE_MS);

// Whether a recorded window still stands for the freshly computed one.
const keepsWindow = (recorded, fresh) =>
  recorded.days === fresh.days &&
  recorded.velocities?.length === fresh.velocities.length &&
  recorded.slacks?.length === fresh.slacks.length &&
  recorded.extrema?.length === fresh.extrema.length &&
  recorded.velocities.every((v, j) => within(v, fresh.velocities[j], VELOCITY_TOLERANCE_KN)) &&
  recorded.slacks.every((slack, j) => sameTime(slack, fresh.slacks[j])) &&
  recorded.extrema.every(
    (e, j) =>
      e.kind === fresh.extrema[j].kind &&
      sameTime(e.time, fresh.extrema[j].time) &&
      within(e.speed, fresh.extrema[j].speed, SPEED_TOLERANCE_KN),
  );

// Whether the recorded golden fit still stands for the freshly computed one.
const keepsPrevious =
  previous !== undefined &&
  isDeepStrictEqual(previous.series, series) &&
  isDeepStrictEqual(previous.events, events) &&
  previous.windows.length === windows.length &&
  previous.windows.every((recorded, i) => keepsWindow(recorded, windows[i])) &&
  stampOf(previous.windows) === previous.stamp;

const golden = keepsPrevious
  ? previous
  : {
      source: "Generated by fixtures/generate/gen-chs-current-golden.mjs from @slackwater/engine",
      series,
      events,
      windows,
      stamp: stampOf(windows),
    };

writeJSON(path, golden);
console.log("chsCurrentFit.stamp", golden.stamp);
