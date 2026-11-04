# Shared Readings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current and tide reading math out of the React package and the iOS app into the TypeScript, Swift and Kotlin engines, checked against one fixture, with React consuming the TypeScript engine.

**Architecture:** Three new modules under `packages/engine/src/readings/` hold series interpolation, current readings and windows, and tide readings and ranking; the engine index re-exports them and `slackwater` passes them through. A `fixtures/readings.json` generated from TypeScript drives Swift (`Readings.swift`) and Kotlin (`Readings.kt`) parity tests. React's utils keep only presentation and import the rest.

**Tech Stack:** TypeScript with vitest and tsdown; Swift 5 with swift-testing; Kotlin/JVM 8 with kotlin.test and JaCoCo; Node fixture generators under `fixtures/generate/`.

**Spec:** `docs/superpowers/specs/2026-11-04-shared-readings-design.md`

## Global Constraints

- 100% line coverage in every TypeScript package (`npm run coverage`) and in Kotlin (JaCoCo rule, `./gradlew jacocoTestCoverageVerification`).
- Instants are `Date` in TypeScript and Swift, `Instant` in Kotlin. Epoch milliseconds never appear in an engine signature.
- Names and shapes follow each language; units, signs, kinds and numbers match across the three engines.
- No engine helper reads a colour anchor or layout constant. Floors and thresholds are parameters.
- No behaviour change to `slackWindows` or to `slackWindowAround`. React's visible and spoken output is unchanged; its tests pass with only import and call-site edits.
- The branch is `feat/shared-readings` on `feat/adopt-current-vectors`. Commit subjects are imperative plain language with no prefix. Every commit ends with the session's attribution trailer.
- Durable prose (READMEs, CONTRACT.md, changesets) describes the current state only, never hard-wrapped.
- Lint before each commit: `npm run lint` (oxlint and prettier). Fix with `npm run format`.

## Review Focus

1. A timeline of exactly one sample: every `*At` helper returns that sample's value at its own instant and undefined elsewhere. Test in Task 1 (`interpolate`).
2. A reading requested at exactly the first or last sample instant: it is inside the series, not outside. Test in Task 2 (`readCurrent`) and Task 4 (`readTide`).
3. A slack threshold of zero or negative: `slackWindowAround` is undefined and `slackRuns` yields a zero-width window per slack, never an exception. Test in Task 3.
4. A flow-peak floor of zero: every run's fastest sample is a peak, including a run of one sample. Test in Task 4.
5. A Swift or Kotlin `CurrentPoint` built from speed alone (magnitude equals absolute speed, no direction) is read as a one-axis sample and takes the published bearing, matching TypeScript's undefined-magnitude fallback. Test in Tasks 8 and 9, and pinned by the fixture's scalar series in Task 7.

---

### Task 1: Engine series helpers

**Files:**

- Create: `packages/engine/src/readings/series.ts`
- Modify: `packages/engine/src/currents.ts:411-460` (`slackWindows` crossing)
- Modify: `packages/engine/src/index.ts` (add `export * from "./readings/series.js";` after the `currents.js` export)
- Test: `packages/engine/test/readings/series.test.ts`

**Interfaces:**

- Produces:
  - `interpolate<T extends { time: Date }>(points: T[], time: Date, value: (p: T) => number): number | undefined` — linear between sorted samples, the first of two samples sharing an instant, undefined outside `[first, last]` or on an empty array.
  - `bandCrossing(a: Pick<CurrentPoint, "time" | "speed">, b: same, threshold: number): Date` — where the signed line from `a` to `b` meets `±threshold` on the side of whichever sample is outside the band. This is React's `cross` in `slackWindowAround` and iOS `bandCrossing`.
  - `peakRank(value: number, values: number[]): number | undefined` — fraction of `values` at or below `value`, ties below; undefined with fewer than two values (React's rule, which `maxSpeeds` and `swingHeights` callers rely on).

- [ ] **Step 1: Write the failing tests**

Port from `packages/react/test/scrubber.test.ts:91-106` (`interpolate`: "linear between samples and undefined outside them", "takes the first of two samples sharing an instant") and `packages/react/test/standing.test.ts:46-58` (`peakRank`). Add:

```ts
test("a single sample reads at its own instant and nowhere else", () => {
  const only = [{ time: new Date(t0), level: 2 }];
  expect(interpolate(only, new Date(t0), (p) => p.level)).toBe(2);
  expect(interpolate(only, new Date(t0 + 1), (p) => p.level)).toBeUndefined();
});
describe("bandCrossing", () => {
  test("same-sign steps cross where the absolute speed meets the band", () => {
    // (0 s, 2 kn) → (600 s, 0 kn), threshold 0.5: at 450 s
    expect(bandCrossing(s(0, 2), s(600, 0), 0.5).getTime()).toBe(t0 + 450_000);
  });
  test("a signed band crossing across a reversal matches iOS", () => {
    // (0 s, −1 kn) → (600 s, +0.1 kn), threshold 0.15: 463.6 s, not the folded 566.7 s
    expect(bandCrossing(s(0, -1), s(600, 0.1), 0.15).getTime()).toBeCloseTo(t0 + 463_636.36, -1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/readings/series.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `series.ts`**

Move `interpolate` from `packages/react/src/utils/scrubber.ts:99-121`, changing `time: number` to `time: Date` (compare with `getTime()` once). `bandCrossing` is the `cross` closure from `packages/react/src/utils/current.ts` inside `slackWindowAround`, returning a `Date`. `peakRank` is `packages/react/src/utils/standing.ts:34-37`.

- [ ] **Step 4: Have `slackWindows` call `bandCrossing` on same-sign steps**

In `slackWindows`, replace the `cross` closure body with: when `a.speed * b.speed >= 0`, return `bandCrossing(a, b, threshold)`; otherwise keep the existing folded expression. Add a comment of one line saying the folded crossing on a reversal step is kept on purpose and points at the README paragraph.

- [ ] **Step 5: Run series and currents tests**

Run: `npx vitest run packages/engine/test/readings/series.test.ts packages/engine/test/currents.test.ts`
Expected: PASS, with every existing `slackWindows` case unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/readings/series.ts packages/engine/src/currents.ts packages/engine/src/index.ts packages/engine/test/readings/series.test.ts
git commit -m "Add series interpolation and band crossing to the engine"
```

---

### Task 2: Engine current readings

**Files:**

- Create: `packages/engine/src/readings/current.ts`
- Modify: `packages/engine/src/index.ts` (add `export * from "./readings/current.js";`)
- Test: `packages/engine/test/readings/current.test.ts`

**Interfaces:**

- Consumes: `interpolate` from Task 1; `CurrentPoint`, `CurrentEvent`, `CurrentEventKind` from `../currents.js`.
- Produces:
  - `type CurrentSample = Pick<CurrentPoint, "time" | "speed" | "magnitude" | "direction">`
  - `interface Directions { flood?: number; ebb?: number }`
  - `type CurrentState = "Slack" | "Max flood" | "Max ebb" | "Flooding" | "Ebbing"`
  - `interface CurrentVector { magnitude: number; direction?: number }`
  - `interface CurrentReading extends CurrentVector { state: CurrentState; speed: number }`
  - `const COMPASS_POINTS: readonly string[]` (N … NNW), `const SPOKEN_COMPASS_POINTS: readonly string[]` (north … north-northwest)
  - `compassIndex(degrees: number): number`, `compass16(degrees: number): string`
  - `speedAt(timeline: CurrentSample[], time: Date): number | undefined`
  - `vectorAt(timeline: CurrentSample[], time: Date, directions: Directions): CurrentVector | undefined` — undefined outside the series; otherwise React's `vectorAt` with the speed computed inside.
  - `readCurrent(time: Date, timeline: CurrentSample[], events: CurrentEvent[], directions: Directions): CurrentReading | undefined`
  - `maxSpeeds(events: CurrentEvent[], kind: "maxFlood" | "maxEbb"): number[]`

- [ ] **Step 1: Write the failing tests**

Port from `packages/react/test/current.test.ts`: the top-level "uses a nonreciprocal published ebb bearing…" (line 36), the whole `vector readings` describe (42-116), `compass16` (165), `speedAt` (173-192), `readCurrent` (296-359) except "slack inside a window" and "a weak maximum inside a comfort window…" which read `slackRuns` and move to Task 3, and `maxSpeeds` from `standing.test.ts:202`. Replace every `t0 + n` time argument with `new Date(t0 + n)` and drop the `[]` windows argument. Add:

```ts
test("reads at the first and last sample instants", () => {
  expect(readCurrent(timeline[0].time, timeline, events, {})).toBeDefined();
  expect(readCurrent(timeline.at(-1)!.time, timeline, events, {})).toBeDefined();
  expect(
    readCurrent(new Date(timeline.at(-1)!.time.getTime() + 1), timeline, events, {}),
  ).toBeUndefined();
});
test("spoken compass points pair with the abbreviations", () => {
  expect(SPOKEN_COMPASS_POINTS[compassIndex(22.5)]).toBe("north-northeast");
  expect(COMPASS_POINTS).toHaveLength(16);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/readings/current.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `current.ts`**

Move `POINTS16`, `SPOKEN_POINTS16`, `compassIndex`, `compass16`, `speedAt`, `vectorAt`, `readCurrent` from `packages/react/src/utils/current.ts` and `maxSpeeds` from `standing.ts`. `vectorAt` calls `speedAt` itself and returns undefined when that is undefined, so one public entry serves both callers. Document each export with one sentence in the house comment style.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/engine/test/readings/current.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/readings/current.ts packages/engine/src/index.ts packages/engine/test/readings/current.test.ts
git commit -m "Add current readings to the engine"
```

---

### Task 3: Engine slack windows around events

**Files:**

- Modify: `packages/engine/src/readings/current.ts`
- Modify: `packages/engine/README.md` (`slackWindows` paragraph at the end of `## Current prediction`)
- Test: `packages/engine/test/readings/current.test.ts`

**Interfaces:**

- Consumes: `bandCrossing` from Task 1; `SlackWindow` from `../currents.js`.
- Produces:
  - `const DEFAULT_SLACK_THRESHOLD = 0.5`
  - `slackWindowAround(timeline: Pick<CurrentPoint, "time" | "speed">[], slack: Date, threshold: number): SlackWindow | undefined`
  - `slackRuns(timeline: Pick<CurrentPoint, "time" | "speed">[], events: CurrentEvent[], threshold: number): SlackWindow[]` — touching or overlapping windows merge (`start <= last.end`); a slack with no window is a zero-width window.

- [ ] **Step 1: Write the failing tests**

Port `slackWindowAround` (193-239) and `slackRuns` (240-275) describes from `packages/react/test/current.test.ts`, splitting "a slack with no window is a zero-width dot run…" (264) so the engine keeps only the zero-width window assertion and the "slack inside a window" and "a weak maximum inside a comfort window…" `readCurrent` cases. Add:

```ts
test("a threshold at or below zero has no window and zero-width runs", () => {
  expect(slackWindowAround(timeline, events[1].time, 0)).toBeUndefined();
  expect(slackWindowAround(timeline, events[1].time, -1)).toBeUndefined();
  expect(slackRuns(timeline, events, 0)).toEqual([{ start: events[1].time, end: events[1].time }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/readings/current.test.ts`
Expected: FAIL, `slackWindowAround is not a function`.

- [ ] **Step 3: Implement**

Move `slackWindowAround` and `slackRuns` from `packages/react/src/utils/current.ts`, using `bandCrossing` for the in-band walk and keeping the out-of-band reversal branch private. `slack` is a `Date`.

- [ ] **Step 4: Document the two window algorithms**

In `packages/engine/README.md`, after the `slackWindows(timeline, threshold)` paragraph, add one paragraph: `slackRuns(timeline, events, threshold)` and `slackWindowAround(timeline, slack, threshold)` start from the engine's slack events, always contain the slack, and report a window for a reversal the sampled series never dips into; `slackWindows` needs no events and only counts a dip that contains a reversal. On a sample step that holds both the reversal and the band edge, `slackWindows` interpolates the absolute speed and the event-centred pair interpolate the signed speed, so their edges can differ there by a fraction of a sample.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run packages/engine/test/readings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/readings/current.ts packages/engine/README.md packages/engine/test/readings/current.test.ts
git commit -m "Add slack windows around events to the engine"
```

---

### Task 4: Engine tide readings and swings

**Files:**

- Create: `packages/engine/src/readings/tide.ts`
- Modify: `packages/engine/src/station.ts:87` (export `feetPerMeter`)
- Modify: `packages/engine/src/index.ts` (add `export * from "./readings/tide.js";`)
- Test: `packages/engine/test/readings/tide.test.ts`

**Interfaces:**

- Consumes: `interpolate` from Task 1; `TimelinePoint`, `Extreme` from `../harmonics/prediction.js`; `Units`, `feetPerMeter` from `../station.js`.
- Produces:
  - `type TidePoint = Pick<TimelinePoint, "time" | "level">`
  - `type TurnPoint = Pick<Extreme, "time" | "level" | "high">`
  - `interface RatePoint { time: Date; rate: number }` (signed metres per hour)
  - `type TideState = "High" | "Low" | "Rising" | "Falling"`
  - `interface TideReading { state: TideState; level: number; up: boolean; rate: number }`
  - `tideRates(timeline: TidePoint[], units: Units): RatePoint[]`
  - `levelAt(timeline: TidePoint[], time: Date): number | undefined`
  - `rateAt(rates: RatePoint[], time: Date): number | undefined`
  - `flowPeaks(rates: RatePoint[], floor: number): RatePoint[]`
  - `levelRange(timeline: TidePoint[], from: Date, to: Date): { min: number; max: number } | undefined`
  - `readTide(time: Date, timeline: TidePoint[], rates: RatePoint[], extremes: TurnPoint[]): TideReading | undefined`
  - `interface Swing { time: Date; range: number }`, `swingRanges(extremes: TurnPoint[]): Swing[]`, `swingHeights(extremes: TurnPoint[]): number[]`

- [ ] **Step 1: Write the failing tests**

Port from `packages/react/test/tide.test.ts`: `tideRates` (34-56), `flowPeaks` (57-74) passing `0.6` as the floor, "levelRange spans only the samples inside the window" (88), `readTide` (159-210) without "speaks the state…" (211). Port `swingHeights` (60-89) from `standing.test.ts`, using `!e.high` where the React fixture used `low`. Times become `Date`. Add:

```ts
test("a floor of zero makes every run's fastest sample a peak", () => {
  const rates = tideRates(series([0, 0.1, 0.3, 0.2, 0]), "meters");
  expect(flowPeaks(rates, 0).map((p) => p.rate > 0)).toEqual([true, false]);
});
test("reads at the first and last sample instants", () => {
  /* as Task 2, with readTide */
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/readings/tide.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `tide.ts`**

Move from `packages/react/src/utils/tide.ts`: `tideRates`, `levelAt`, `rateAt`, `flowPeaks` (floor parameter replaces `FAST_RATE`), `levelRange`, `readTide`. Move `swingRanges` and `swingHeights` from `standing.ts`, with `Swing.time` a `Date` and the same-kind test written as `e.high === prev.high`. Export `feetPerMeter` from `station.ts` and use it here.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/engine/test/readings/tide.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/readings/tide.ts packages/engine/src/station.ts packages/engine/src/index.ts packages/engine/test/readings/tide.test.ts
git commit -m "Add tide readings and swing ranges to the engine"
```

---

### Task 5: Public surface, README and changesets

**Files:**

- Modify: `packages/slackwater/src/index.ts:19` (the `export { slackWindows } from "@slackwater/engine";` line)
- Modify: `packages/engine/README.md` (new `## Readings` section before `## Harmonic fitting`)
- Modify: `packages/slackwater/README.md` (one sentence under `### Current predictions`)
- Create: `.changeset/engine-readings.md`, `.changeset/slackwater-readings.md`
- Test: `packages/engine/test/index.test.ts`, `packages/slackwater/test/index.test.ts` (whichever exists; add one import-shape test)

**Interfaces:**

- Consumes: everything Tasks 1-4 export.
- Produces: the same names from `slackwater`.

- [ ] **Step 1: Write the failing test**

In the `slackwater` package test, assert that `readCurrent`, `readTide`, `slackRuns`, `tideRates`, `peakRank` and `compass16` are functions exported from `../src/index.js`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/slackwater`
Expected: FAIL on the undefined exports.

- [ ] **Step 3: Re-export and document**

Extend the `slackwater` export line to every value and type exported from the three readings modules. Write the README section with one example each: reading a current at an instant from `getTimelinePrediction` and `getEventsPrediction` output; reading a tide from a timeline, its `tideRates` and `getExtremesPrediction`; `flowPeaks` with a caller-chosen floor; `slackRuns` with a threshold; `peakRank` over `swingHeights` and over `maxSpeeds`. State in prose that a zero vector has no direction, that readings use a one-second reach to events, and that `tideRates` is a central difference over samples where Swift and Kotlin also offer an analytic rate.

- [ ] **Step 4: Write the changesets**

`@slackwater/engine` minor: "Read the water at an instant from a timeline and its events: current state, speed, full vector speed and Set; tide state, height and rate; slack windows around each slack event; sampled tide rates and flow peaks; swing ranges and percentile ranks. These are the calculations the Slackwater apps use, with no framework dependency." `slackwater` minor: one sentence that the same helpers are re-exported.

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/engine packages/slackwater && npm run lint`
Expected: PASS, clean lint.

- [ ] **Step 6: Commit**

```bash
git add packages/slackwater packages/engine/README.md .changeset/engine-readings.md .changeset/slackwater-readings.md
git commit -m "Expose the readings from slackwater and document them"
```

---

### Task 6: React consumes the current readings

**Files:**

- Modify: `packages/react/package.json` (add `"@slackwater/engine": "^1.0.0-beta.9"` to `dependencies`), `package-lock.json` via `npm install`
- Modify: `packages/react/src/utils/current.ts`, `packages/react/src/utils/scrubber.ts` (remove `interpolate`)
- Modify: `packages/react/src/utils/card.ts:109`, `packages/react/src/utils/pin.ts:122`, `packages/react/src/components/CurrentScrubber.tsx:108,143,334,337,343`, `packages/react/src/components/StationCard.tsx:11,183`, `packages/react/src/components/StationsMap.tsx:49`
- Test: `packages/react/test/current.test.ts`, `packages/react/test/scrubber.test.ts`, `packages/react/test/standing.test.ts`

**Interfaces:**

- Consumes: Task 2 and Task 3 exports from `@slackwater/engine`.
- Produces: `utils/current.ts` keeps `SlackWindow` (re-exported type), `EMPTY_MESSAGE`, `speedColor`, `threadOpacity`, `slackAxisTimes`, `isDotRun`, `runCenter`, `currentStops`, `snapTargets`, `formatSpeed`, `formatSet`, `spokenBearing`, `spokenSet`, `spokenReading`, and re-exports `type CurrentReading`, `type CurrentState`, `type Directions` from the engine for its components.

- [ ] **Step 1: Trim the React tests**

Delete from `packages/react/test/current.test.ts` every case moved in Tasks 2 and 3 and from `scrubber.test.ts` the `interpolate` describe; delete `maxSpeeds` from `standing.test.ts`. Where a remaining test builds runs with `slackRuns` or reads with `readCurrent`, import those from `@slackwater/engine` and pass `Date`s.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/react/test/current.test.ts`
Expected: FAIL, the engine does not yet resolve from React, or the old signatures reject `Date`.

- [ ] **Step 3: Add the dependency and rewire**

`npm install` after editing `package.json`. In `utils/current.ts` delete the moved code and import `compass16`, `compassIndex`, `SPOKEN_COMPASS_POINTS` for `formatSet` and `spokenBearing`; delete `interpolate` from `scrubber.ts`. At each call site import from `@slackwater/engine`, wrap millisecond times with `new Date(t)` and drop the windows argument from `readCurrent`.

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/react && npm run build --workspace @slackwater/react`
Expected: PASS, and the built `dist/index.js` does not inline the engine (grep for `createCurrentPredictor` finds nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/react package-lock.json
git commit -m "Read currents in React through the engine"
```

---

### Task 7: React consumes the tide readings and ranking

**Files:**

- Modify: `packages/react/src/utils/tide.ts`, `packages/react/src/utils/standing.ts`
- Modify: `packages/react/src/utils/card.ts:84-89`, `packages/react/src/utils/pin.ts:97`, `packages/react/src/components/TideScrubber.tsx:70-71,100,255-256,269,324,334`, `packages/react/src/components/StationCardGraph.tsx:25,286`, `packages/react/src/components/TideStation.tsx:10,120`, `packages/react/src/components/Scrubber.tsx:30`
- Modify: `CONTRIBUTING.md:96` (the React paragraph's `utils/tide.ts` and `utils/standing.ts` mentions)
- Create: `.changeset/react-readings.md`
- Test: `packages/react/test/tide.test.ts`, `packages/react/test/standing.test.ts`

**Interfaces:**

- Consumes: Task 4 exports; `peakRank` from Task 1.
- Produces: `utils/tide.ts` keeps `EMPTY_TIDE_MESSAGE`, `FAST_RATE`, `tideStops`, `TideScale` and the scale helpers, `rateColor`, `fastTideInk`, `formatHeight`, `heightUnit`, `fastTideText`, `spokenTide`, re-exporting `type TideState`, `type TideReading`, `type RatePoint`. `utils/standing.ts` keeps the window, outlook and tile helpers; `dailySwingRanges` uses the engine's `swingRanges` and `swing.time.getTime()`.

- [ ] **Step 1: Trim the React tests**

Delete the cases moved in Task 4 from `tide.test.ts` and `peakRank` and `swingHeights` from `standing.test.ts`. Remaining `tideStops` and `spokenTide` tests import `tideRates`, `flowPeaks` and `readTide` from the engine where they need them, passing `FAST_RATE` to `flowPeaks`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/react/test/tide.test.ts packages/react/test/standing.test.ts`
Expected: FAIL on the removed exports.

- [ ] **Step 3: Rewire**

Delete the moved functions, import from `@slackwater/engine` at each call site, wrap times with `new Date(t)`, pass `FAST_RATE` to `flowPeaks`. Update the CONTRIBUTING sentence to say the tide track's scale governance stays in `utils/tide.ts` while readings, rates and swings come from `@slackwater/engine`.

- [ ] **Step 4: Write the changeset**

`@slackwater/react` patch: "Readings, rates, slack windows and rankings now come from `@slackwater/engine`, which the package depends on. Nothing visible changes."

- [ ] **Step 5: Verify**

Run: `npm run coverage && npm run lint`
Expected: PASS, 100% lines in engine, react and slackwater.

- [ ] **Step 6: Commit**

```bash
git add packages/react CONTRIBUTING.md .changeset/react-readings.md
git commit -m "Read tides and rankings in React through the engine"
```

---

### Task 8: Readings fixture

**Files:**

- Create: `fixtures/generate/gen-readings.mjs`, `fixtures/readings.json`
- Modify: `package.json:12` (`fixtures:check` gains `&& node fixtures/generate/gen-readings.mjs --check`)
- Test: `npm run fixtures:check`

**Interfaces:**

- Consumes: the engine's readings from Tasks 1-4 and `createCurrentPredictor`, `createTidePredictor`.
- Produces `fixtures/readings.json`:

```json
{
  "note": "...",
  "vector": { "start", "end", "timeFidelity": 600, ...the currents-vector.json inputs,
    "timeline": [{ "time", "speed", "magnitude", "direction" }], "events": [{ "time", "speed", "kind" }],
    "threshold": 0.5, "runs": [{ "start", "end" }],
    "windows": [{ "slack", "start", "end" }],
    "readings": [{ "time", "state", "speed", "magnitude", "direction"? }] },
  "scalar": { "flood": 45, "ebb": 200, "timeline": [{ "time", "speed" }], "events": [...],
    "readings": [...] },
  "tide": { "start", "end", "constituents", "timeline": [{ "time", "level" }], "extremes": [{ "time", "level", "high" }],
    "rates": [{ "time", "rate" }], "peaks": [{ "time", "rate" }] at floor 0.6,
    "readings": [{ "time", "state", "level", "up", "rate" }],
    "swings": [number], "ranks": [{ "value", "rank" }] }
}
```

- [ ] **Step 1: Write the generator**

Follow `gen-currents.mjs`. Vector: the `vectorInputs` station from `gen-currents.mjs` over `2026-06-01` to `2026-06-02` at 600 s, events from `getEventsPrediction`, `runs` from `slackRuns`, `windows` from `slackWindowAround` per slack event, and `readings` at every hour plus one second before and after each event. Scalar: the hand series `[(0 h, 0.3), (1 h, −0.3), (2 h, 0.3)]` with flood 45 and ebb 200 and no magnitude in the JSON, readings at 0.4 h, 0.5 h, 0.6 h and 1 h. Tide: `createTidePredictor` with the constituents of `fixtures/prediction-victoria.json` over the same two days, `tideRates(..., "meters")`, `flowPeaks(rates, 0.6)`, readings at every hour plus each extreme's instant, `swingHeights` of the extremes, and `peakRank` of each swing among them.

- [ ] **Step 2: Generate and check**

Run: `npm run build --workspace @slackwater/engine && node fixtures/generate/gen-readings.mjs && npm run fixtures:check`
Expected: `wrote readings.json`, then every generator reports `checked`.

- [ ] **Step 3: Commit**

```bash
git add fixtures/generate/gen-readings.mjs fixtures/readings.json package.json
git commit -m "Add the readings parity fixture"
```

---

### Task 9: Swift readings

**Files:**

- Create: `swift/Sources/SlackwaterKit/Readings.swift` (current side), `swift/Sources/SlackwaterKit/TideReadings.swift`
- Modify: `swift/README.md` (new `### Readings` under `## Use`, after `### Currents`)
- Test: `swift/Tests/SlackwaterKitTests/ReadingsTests.swift`

**Interfaces:**

- Consumes: `CurrentPoint`, `CurrentEvent`, `CurrentEventKind`, `TidePoint`, `TideRatePoint`, `TideExtreme`, `ranges()`, `percentileRank(of:)`.
- Produces, all `public` and `Sendable`:
  - `extension Array where Element == TidePoint { func height(at: Date) -> Double?; func rates() -> [TideRatePoint]; func range(from: Date, to: Date) -> (min: Double, max: Double)? }`
  - `extension Array where Element == TideRatePoint { func rate(at: Date) -> Double? }`
  - `extension Array where Element == CurrentPoint { func speed(at: Date) -> Double?; func vector(at: Date, flood: Double?, ebb: Double?) -> CurrentVector? }`
  - `struct CurrentVector { let magnitude: Double; let direction: Double? }`
  - `enum CurrentState { case slack, maxFlood, maxEbb, flooding, ebbing }`
  - `struct CurrentReading { let state: CurrentState; let speed: Double; let magnitude: Double; let direction: Double? }`
  - `func readCurrent(at: Date, timeline: [CurrentPoint], events: [CurrentEvent], flood: Double?, ebb: Double?) -> CurrentReading?`
  - `let compassPoints: [String]`, `let spokenCompassPoints: [String]`, `func compassIndex(_ degrees: Double) -> Int`, `func compassPoint(_ degrees: Double) -> String`
  - `let defaultSlackThreshold = 0.5`
  - `struct SlackWindow { let start: Date; let end: Date }`
  - `func slackWindow(_ points: [CurrentPoint], around slack: Date, threshold: Double) -> SlackWindow?`
  - `func mergeWindows(_ windows: [SlackWindow]) -> [SlackWindow]`
  - `func slackRuns(_ points: [CurrentPoint], events: [CurrentEvent], threshold: Double) -> [SlackWindow]`
  - `func flowPeaks(_ rates: [TideRatePoint], floor: Double) -> [TideRatePoint]`
  - `enum TideState { case high, low, rising, falling }`
  - `struct TideReading { let state: TideState; let height: Double; let rising: Bool; let rate: Double }`
  - `func readTide(at: Date, heights: [TidePoint], rates: [TideRatePoint], extremes: [TideExtreme]) -> TideReading?`
  - `extension Array where Element == CurrentEvent { func maxSpeeds(_ kind: CurrentEventKind) -> [Double] }`
  - `extension Array where Element == TideExtreme { func swingHeights() -> [Double] }` as `ranges().map(\.height)`

A point with `direction == nil` and `magnitude == abs(speed)` is a one-axis sample: `vector(at:)` gives it the published bearing for its sign, matching TypeScript's undefined-magnitude fallback (Review Focus 5). `slackWindow` is the iOS `slackWindow` from `Slackwater/SlackWindow.swift:58-96` with `bandCrossing` from `:99`, minus the `slackWindowIsOff` wrapper (a threshold at or below zero returns nil). `mergeWindows` is `:128` returning `SlackWindow`.

- [ ] **Step 1: Write the failing tests**

`ReadingsTests.swift` with one `@Test` per TypeScript describe: interpolation at, between and outside samples; vector through north, cancellation, zero vector without bearing, one-axis fallback with non-reciprocal bearings, unknown endpoint beside a known one; `readCurrent` slack, max and phase within one second and at the first and last samples; compass points; `slackWindow` band crossings, out-of-band reversal, widening to hold the slack, clamping, nil at zero threshold; `mergeWindows`; `rates()` central differences and one-sided ends; `flowPeaks` at 0.6 and at 0; `readTide` at a turn, rising toward a high, falling back to the rate sign; `maxSpeeds` and `swingHeights`. Then `readingsMatchSharedFixture` decoding `fixtures/readings.json` through `loadFixture` and comparing: times within 0.5 s, speeds, magnitudes, rates, heights and swings within 1e-6, directions within 1e-5 by `angularDiff`, states by name.

- [ ] **Step 2: Run to verify failure**

Run: `cd swift && swift test -c release --filter ReadingsTests`
Expected: build failure on the missing symbols.

- [ ] **Step 3: Implement the two files**

Port each function from the TypeScript in Tasks 1-4, using the iOS code named above as the source for the window pair. Keep `Readings.swift` and `TideReadings.swift` each under 300 lines.

- [ ] **Step 4: Document**

Add `### Readings` to `swift/README.md` with one example that reads a current and one that reads a tide from `speeds`, `events`, `heights`, `rates` and `extremes`, naming the one-axis rule and that `[TidePoint].rates()` is a sampled difference where `Station.rates` is analytic.

- [ ] **Step 5: Verify**

Run: `cd swift && swift test -c release`
Expected: all tests pass, including the fixture parity test.

- [ ] **Step 6: Commit**

```bash
git add swift/Sources/SlackwaterKit/Readings.swift swift/Sources/SlackwaterKit/TideReadings.swift swift/Tests/SlackwaterKitTests/ReadingsTests.swift swift/README.md
git commit -m "Add readings to SlackwaterKit"
```

---

### Task 10: Kotlin readings

**Files:**

- Create: `kotlin/src/main/kotlin/io/openwaters/slackwater/Readings.kt`
- Modify: `kotlin/README.md` (new `## Readings` after `## Predict`; the sentence under `## Predict` listing ranking as outside this port drops "ranking")
- Test: `kotlin/src/test/kotlin/io/openwaters/slackwater/ReadingsTest.kt`

**Interfaces:**

- Consumes: `TidePoint`, `TideRatePoint`, `TideExtreme`, `ExtremeKind`, `CurrentPoint`, `CurrentEvent`, `CurrentEventKind`.
- Produces, top-level in the package:
  - `fun List<TidePoint>.heightAt(time: Instant): Double?`, `fun List<TidePoint>.sampledRates(): List<TideRatePoint>`, `fun List<TidePoint>.heightRange(from: Instant, to: Instant): HeightRange?` with `data class HeightRange(val minMetres: Double, val maxMetres: Double)`
  - `fun List<TideRatePoint>.rateAt(time: Instant): Double?`
  - `fun List<CurrentPoint>.speedAt(time: Instant): Double?`, `fun List<CurrentPoint>.vectorAt(time: Instant, floodDirectionDegrees: Double?, ebbDirectionDegrees: Double?): CurrentVector?`
  - `data class CurrentVector(val magnitudeKnots: Double, val directionDegrees: Double?)`
  - `enum class CurrentState { SLACK, MAX_FLOOD, MAX_EBB, FLOODING, EBBING }`
  - `data class CurrentReading(val state: CurrentState, val speedKnots: Double, val magnitudeKnots: Double, val directionDegrees: Double?)`
  - `fun readCurrent(time: Instant, timeline: List<CurrentPoint>, events: List<CurrentEvent>, floodDirectionDegrees: Double?, ebbDirectionDegrees: Double?): CurrentReading?`
  - `val COMPASS_POINTS: List<String>`, `val SPOKEN_COMPASS_POINTS: List<String>`, `fun compassIndex(degrees: Double): Int`, `fun compassPoint(degrees: Double): String`
  - `const val DEFAULT_SLACK_THRESHOLD_KNOTS = 0.5`
  - `data class SlackWindow(val start: Instant, val end: Instant)`
  - `fun slackWindowAround(points: List<CurrentPoint>, slack: Instant, thresholdKnots: Double): SlackWindow?`, `fun mergeWindows(windows: List<SlackWindow>): List<SlackWindow>`, `fun slackRuns(points: List<CurrentPoint>, events: List<CurrentEvent>, thresholdKnots: Double): List<SlackWindow>`
  - `fun flowPeaks(rates: List<TideRatePoint>, floorMetresPerHour: Double): List<TideRatePoint>`
  - `enum class TideState { HIGH, LOW, RISING, FALLING }`
  - `data class TideReading(val state: TideState, val heightMetres: Double, val rising: Boolean, val rateMetresPerHour: Double)`
  - `fun readTide(time: Instant, heights: List<TidePoint>, rates: List<TideRatePoint>, extremes: List<TideExtreme>): TideReading?`
  - `fun List<Double>.percentileRank(value: Double): Double?` (null when empty, as Swift), `fun List<TideExtreme>.swingHeights(): List<Double>`, `fun List<CurrentEvent>.maxSpeeds(kind: CurrentEventKind): List<Double>`

Instant arithmetic uses `secondsBetween` style nanosecond durations and `Instant.plusNanos` for crossings so sub-second edges survive. The one-axis rule from Task 9 applies.

- [ ] **Step 1: Write the failing tests**

`ReadingsTest.kt` mirroring Task 9's cases with `kotlin.test`, plus `readingsMatchSharedFixture` through `fixture("readings")` and the `FixtureSupport` helpers at the same tolerances.

- [ ] **Step 2: Run to verify failure**

Run: `cd kotlin && ./gradlew test --tests 'io.openwaters.slackwater.ReadingsTest'`
Expected: compilation failure on the missing symbols.

- [ ] **Step 3: Implement `Readings.kt`**

Port from the TypeScript in Tasks 1-4.

- [ ] **Step 4: Document**

Add `## Readings` to `kotlin/README.md` with one Kotlin example reading a current and a tide, and amend the "outside this port" sentence.

- [ ] **Step 5: Verify**

Run: `cd kotlin && ./gradlew test jacocoTestReport jacocoTestCoverageVerification && ./gradlew -p smoke run`
Expected: BUILD SUCCESSFUL with the coverage rule satisfied.

- [ ] **Step 6: Commit**

```bash
git add kotlin/src/main/kotlin/io/openwaters/slackwater/Readings.kt kotlin/src/test/kotlin/io/openwaters/slackwater/ReadingsTest.kt kotlin/README.md
git commit -m "Add readings to the Kotlin engine"
```

---

### Task 11: Contract and whole-branch verification

**Files:**

- Modify: `docs/CONTRACT.md:31-50` (correspondence table), `:53-62` (shared edge cases), `:64-77` (parity table), `:114-124` (asymmetry table)
- Test: the whole suite

- [ ] **Step 1: Update the contract**

Correspondence rows: "Tide rate" gains `tideRates` (sampled) in TypeScript with a note that Swift and Kotlin also offer the analytic rate; new rows "Reading at one instant" (`readCurrent`, `readTide` / `readCurrent(at:)`, `readTide(at:)` / `readCurrent`, `readTide`), "Slack window around an event" (`slackWindowAround`, `slackRuns` / `slackWindow(_:around:threshold:)`, `slackRuns` / `slackWindowAround`, `slackRuns`), and "Extreme ranking" filled in all three columns (`swingHeights`, `peakRank` / `ranges`, `percentileRank` / `swingHeights`, `percentileRank`). Shared edge cases: add the one-second reach, no direction at zero magnitude, and the one-axis rule for Swift and Kotlin points. Parity table: a "Readings" row, `fixtures/readings.json`, times `< 0.5 s`, speeds and heights `< 1e-6`, directions `< 1e-5°`. Asymmetry table: "Extreme ranking against a station's history" becomes yes in all three; add nothing else.

- [ ] **Step 2: Run everything**

Run:

```bash
npm run build && npm run coverage && npm run lint && npm run fixtures:check
(cd swift && swift test -c release)
(cd kotlin && ./gradlew test jacocoTestReport jacocoTestCoverageVerification)
```

Expected: all pass; coverage reports 100% lines for engine, react and slackwater.

- [ ] **Step 3: Commit**

```bash
git add docs/CONTRACT.md
git commit -m "Record the shared readings in the engine contract"
```
