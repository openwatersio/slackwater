# Shared current and tide readings in the engines

Issue [#510](https://github.com/openwatersio/slackwater/issues/510). Stacked on [#508](https://github.com/openwatersio/slackwater/pull/508), whose branch carries the vector reading this extracts.

## Intent

Developers who build on the Slackwater engines for their own projects get the same reading calculations the Slackwater apps use: what the water is doing at an instant, from a timeline and its events. Today those calculations live in the React package (`packages/react/src/utils/{current,tide,standing}.ts`) and in the iOS app's own Swift (`SlackWindow.swift`, `CurrentLead.swift`, `TideMovement.swift`, `CurrentStation.swift` and others), each reachable only through its app. Moving them into the three engines gives every consumer one tested contract, and the apps become presentation layers over it.

## Goals

- `@slackwater/engine`, `SlackwaterKit` and the Kotlin engine each export the reading math for currents and tides, with public types that do not depend on an app framework.
- The three implementations agree numerically and are checked against one fixture generated from TypeScript, the way the current vector and parity fixtures are.
- React consumes the TypeScript engine's versions and keeps no copy of its own.
- The import is browser-safe: `@slackwater/engine` already has no database dependency, and the `slackwater` package re-exports the helpers the way it re-exports `slackWindows`.
- The domain regression coverage moves into engine unit tests. React keeps integration and presentation tests.
- The engine README documents each public helper with an example a non-React consumer can paste. The Swift and Kotlin READMEs name their counterparts.
- The engine's `slackWindows` and the event-centred window helpers are compared and documented, and the band-crossing interpolation they share is written once per engine.
- `docs/CONTRACT.md` records the new capabilities in its correspondence and asymmetry tables.

## Non-goals

- No change to what slack means, and no rotary minimum-speed events. The signed major-axis speed and the full vector speed remain distinct.
- No change to React's visible or spoken output. Every existing React test still passes unchanged apart from import paths.
- No change to the iOS app in this change. Its adoption of these helpers, together with the full-speed and Set reading from #508, is a follow-up in slackwater-ios.
- No new package and no subpath export.
- No analytic tide rate in TypeScript. Swift and Kotlin keep their analytic `rates`; the sampled central-difference rate added here is a different capability and is recorded as such in the contract.

## Anti-goals

- Presentation policy leaking into an engine: colours, opacity, drawing widths, stop labels, magnet snapping, navigation stops, event-label timing, the watch's 200-second reach, locale formatting and composed sentences stay in the apps.
- An engine helper that reads an app colour anchor or layout constant, as `flowPeaks` in React and `tideFlowArrows` in iOS do today.
- Changing the behaviour of either existing window algorithm in the name of consolidation.

## Constraints

- 100% line coverage in every TypeScript package and in Kotlin (JaCoCo). Swift tests run with `swift test -c release`.
- Each TypeScript package has a changeset. The engine's is the feature; React's says it now reads from the engine; `slackwater`'s names the new re-exports. All prerelease changesets under `.changeset/`.
- The branch bases on `feat/adopt-current-vectors` and targets it until #508 merges, then rebases onto `main`.
- Instants are `Date` in TypeScript, `Date` in Swift and `Instant` in Kotlin, matching each engine's existing public API. React's scrubber works in epoch milliseconds and wraps with `new Date(t)` at its call sites. Decided with the owner.

## Decisions

### TypeScript layout

Two new engine modules, `packages/engine/src/readings/current.ts` and `packages/engine/src/readings/tide.ts`, plus `packages/engine/src/readings/series.ts` for the interpolation both share. The engine index re-exports all three with `export *`. The `slackwater` package adds the same names to its existing `export { slackWindows } from "@slackwater/engine"` line.

### TypeScript types

Helpers accept structural minimums built on the engine's existing types, in the style `slackWindows` already uses:

- `TidePoint = Pick<TimelinePoint, "time" | "level">`
- `CurrentSample = Pick<CurrentPoint, "time" | "speed" | "magnitude" | "direction">`
- `TurnPoint = Pick<Extreme, "time" | "level" | "high">`
- `CurrentEvent` as it is.

React's `TimelineEntry`, `CurrentTimelineEntry` and `Extreme` already satisfy these, so React passes its data through with no conversion. The result types (`CurrentReading`, `TideReading`, `RatePoint`, `SlackWindow`) move to the engine; React re-exports the ones its components take as props so its public surface does not change.

### What moves into the TypeScript engine

From `current.ts`:

- `speedAt`, `vectorAt` (made public), `readCurrent`, with `CurrentState`, `CurrentReading`, `Directions`. `readCurrent` drops its unused `_windows` parameter in the engine signature.
- `compass16`, plus the 16-point index and spoken names that `spokenBearing` uses, as `compassIndex` and `COMPASS_POINTS` / `SPOKEN_COMPASS_POINTS`. These are bearing helpers, not presentation policy.
- `slackWindowAround` and `slackRuns`, keeping their event-centred semantics (below).
- `DEFAULT_SLACK_THRESHOLD`.

From `tide.ts`:

- `tideRates`, `levelAt`, `rateAt`, `levelRange`, `readTide`, with `RatePoint`, `TideState`, `TideReading`.
- `flowPeaks(rates, floor)`, where `floor` is the rate in metres per hour at or above which a run's fastest sample counts. React passes `FAST_RATE`.

From `standing.ts`:

- `peakRank`, `swingHeights`, `maxSpeeds`.

From `scrubber.ts`:

- `interpolate`.

Everything else in those files stays in React and imports what it needs from the engine. `isDotRun`, `runCenter`, `slackAxisTimes`, `currentStops`, `snapTargets`, `tideStops`, the scale helpers, the colour and ink helpers, all `format*` and `spoken*` functions, `EMPTY_MESSAGE`, `EMPTY_TIDE_MESSAGE` and `FAST_RATE` do not move. `targetsWithin` stays with the scrubber.

### Swift and Kotlin

Each engine gains the same capabilities under its own naming conventions. Names and shapes follow each language; units, signs, kinds and numbers match. The Swift source for each is the iOS app's own implementation where one exists, since the React code was written to match iOS; the Kotlin source is the TypeScript.

Swift, in `swift/Sources/SlackwaterKit/Readings.swift` (split in two files if it passes about 300 lines):

- `interpolate` over any `[(Date, Double)]`-shaped series; `[TidePoint].height(at:)`, `[TideRatePoint].rate(at:)`, `[CurrentPoint].speed(at:)`, each `nil` outside the series. The app's `TimelineData.interp` clamps at the ends; the engine does not, matching TypeScript. The app keeps its clamping wrapper.
- `[CurrentPoint].vector(at:flood:ebb:)` returning magnitude and optional direction with the same fallbacks as TypeScript's `vectorAt`.
- `CurrentReading` with `state: CurrentState` (`.slack`, `.maxFlood`, `.maxEbb`, `.flooding`, `.ebbing`), `speed`, `magnitude`, `direction?`; `readCurrent(at:timeline:events:flood:ebb:)`.
- `compassPoint(_:)` returning the 16-point abbreviation, and `compassIndex(_:)`.
- `slackWindow(_:around:threshold:)` and `mergeWindows(_:)` moved from the app's `SlackWindow.swift`, returning the kit's existing `SlackWindow`-style struct (`start`, `end`). The app's `WindowRun` conveniences (`contains`, `holdsSlack`) stay in the app.
- `[TidePoint].rates()` as the sampled central-difference rate in metres per hour, distinct from the analytic `Station.rates(from:to:step:)`; `flowPeaks(_:floor:)`; `[TidePoint].range(from:to:)`.
- `TideReading` with `state` (`.high`, `.low`, `.rising`, `.falling`), `height`, `rising`, `rate`; `readTide(at:heights:rates:extremes:)`.
- `[CurrentEvent].maxSpeeds(_:)` per kind. `percentileRank` and `ranges()` already exist and are the counterparts of `peakRank` and `swingHeights`.

Kotlin, in `kotlin/src/main/kotlin/io/openwaters/slackwater/Readings.kt`, the same set with `Instant` and nullable returns, as top-level functions and extension functions matching the file's neighbours.

Contract choices that the ports pin down:

- A zero vector has no direction. iOS today shows the flood bearing at exactly zero speed; the engine reading gives none, and the app's slack state already hides the set.
- Slack is within one second of a slack event. Max flood or ebb is within one second of that event. Otherwise the sign of the signed speed decides flooding or ebbing.
- The tide reading is High or Low within one second of an extreme, else rising or falling toward the next extreme, else by the sign of the sampled rate.
- The flow-peak floor and the fast-tide floor are parameters. Each app passes its own colour-ramp anchor.

### Window semantics

The two algorithms answer different questions and both stay:

- `slackWindows(timeline, threshold)` scans a whole series and reports every run inside the band that contains a sign change. It needs no event list. A dip that never reverses is weak water and is not a window.
- `slackWindowAround(timeline, slack, threshold)` starts from one known slack instant and walks outward to the band edges. When the two samples bracketing the slack are both outside the band, it still reports the straight-line crossing between them. It always contains the slack. `slackRuns` applies it to every slack event in a series and merges touching windows.

The shared piece is the band crossing between two adjacent samples of the same sign. `series.ts` holds one `bandCrossing(a, b, threshold)` for that case and both algorithms call it. On a step that holds both the reversal and the band edge the two disagree: `slackWindows` interpolates the folded absolute speed, `slackWindowAround` interpolates the signed speed, and React's test pins the signed value as matching iOS. Each keeps its own formula for that step, since the issue asks to consolidate only where they agree. The out-of-band reversal branch of `slackWindowAround` stays private to the current readings module. The README states the difference in one paragraph and names when to use each: `slackWindows` when you only have a timeline, `slackRuns` when you have the engine's events and want each event's own window, including a window for a slack the sampled series never dips into. The folded crossing in `slackWindows` is recorded as a separate finding, not changed here.

Swift and Kotlin have no `slackWindows` today, so they gain only the event-centred pair.

### Fixture

`fixtures/generate/gen-readings.mjs` writes `fixtures/readings.json` from the TypeScript engine, following `gen-currents.mjs`, and `npm run fixtures:check` gains its `--check`. The fixture holds a short synthetic current series with magnitude and direction (reusing the `currents-vector.json` station), a scalar series with non-reciprocal bearings, a tide series with its extremes, and for each a list of instants with the expected reading, speed, vector, window, rate and peak outputs. Swift (`ReadingsTests.swift`) and Kotlin (`ReadingsTest.kt`) load it through their existing fixture helpers and compare at the contract's timeline tolerances: times within 0.5 s, speeds and rates within 1e-6, directions within 1e-5 degrees circular.

### Tests

- Engine tests at `packages/engine/test/readings/{current,tide,series}.test.ts` take over the domain cases from `packages/react/test/{current,tide,standing}.test.ts`: direction wrapping through north, vector cancellation, undefined Set at zero speed, scalar fallbacks with non-reciprocal bearings, missing bearings, interpolation at and beyond the series ends, window edges at the frame and around a windowless zero, rate central differences and one-sided ends, flow peaks across a sign change and at the floor.
- The React tests for moved functions are deleted. React keeps tests for its stops, snapping, formatting, spoken text, scale governance and the components.
- Swift and Kotlin each get unit tests for the same edge cases in their own style, plus the fixture parity test.
- Coverage in every TypeScript package and in Kotlin stays at 100%.

### Documentation

- A new `## Readings` section in `packages/engine/README.md` after `## Current prediction`, with one example each for reading a current, reading a tide, tide rates and peaks, slack windows around events, and the ranking helpers. The `slackwater` README gains a sentence pointing at it.
- `swift/README.md` and `kotlin/README.md` each gain a short Readings paragraph with one example.
- `docs/CONTRACT.md`: the correspondence table gains rows for sampled tide rate, instant readings, slack window around an event, and extreme ranking in all three columns; the asymmetry table marks extreme ranking as shared and keeps tide-derived slack Swift-only; the parity table gains a Readings row at the tolerances above.
- The React README's `utils/tide.ts` and `utils/standing.ts` mentions in CONTRIBUTING are updated to say which parts now come from the engine.

### Follow-ups filed, not done here

- slackwater-ios: adopt the kit readings and the #508 full-speed and Set reading; drop the app's `SlackWindow.swift` window code, `compass16`, `interp`, and lead-state logic in favour of the kit.
- slackwater-ios: the Dodd map flow provider derives the ebb bearing as flood plus 180 degrees instead of the published ebb bearing.
- slackwater: `slackWindows` interpolates the folded absolute speed on a step that holds both the reversal and the band edge, which disagrees with the signed crossing iOS and `slackWindowAround` use.

## Left to the builder

- Exact names for the exported point types; keep them consistent with `CurrentPoint` and `TimelinePoint`.
- Whether `vectorAt` takes the already-interpolated `speed` as today or computes it; it may compute it if that keeps one binary search.
- Test fixture style; follow the series helpers in the existing React tests and the `VectorFixture` decoding style in Swift.
- Whether the merge of touching windows uses `start <= end` (React) or the app's half-open `holdsSlack` rule; pick React's and note it in the fixture.
- Changeset wording, following the release-notes guidance in CONTRIBUTING.
