# Engine contract

The TypeScript, Swift and Kotlin engines implement the same harmonic tide model. The fixtures in `fixtures/` define their shared numerical contract. Each language may expose an idiomatic API, but changes to the model, conventions, or shared results must update this document and the fixtures in the same pull request.

## Time

- Inputs and outputs are absolute instants. TypeScript uses `Date`; Swift uses `Foundation.Date`; Kotlin uses `java.time.Instant`.
- Fixture timestamps are ISO 8601 UTC strings ending in `Z`. Engines must not apply a local time zone during prediction.
- Constituent phase is relative to GMT. Current constituents use NOAA `majorPhaseGMT`.
- Timeline sampling floors the start and ceils the end to the requested step, including both resulting timestamps. Event searches return detected roots inside the search window; roots exactly on a bracket boundary are not guaranteed. A tide extreme or current maximum that two days' parameters put on opposite sides of midnight UTC is found once, at midnight. A current slack within about a second of a node-correction refresh, every 24 hours from the start of its search, is not guaranteed. A harmonic station's tide extremes and current maxima do not depend on the window: once windows are widened to whole 10-minute steps, the extremes of any window are exactly those of a longer window that fall inside it ([packages/engine/docs/extremes.md](../packages/engine/docs/extremes.md)). Subordinate tide stations do not have this guarantee: the TypeScript engine shifts the reference's extremes found in the subordinate's own window ([#363](https://github.com/openwatersio/slackwater/issues/363)), and all three engines draw a subordinate's curve from the reference's raw turning points when the extremes found don't surround the window. Timeline steps are seconds in Swift, and TypeScript uses the same unit for `timeFidelity`. A height at one instant is evaluated at that instant, without timeline snapping.
- Node corrections are recalculated through long prediction windows. Results at the fixture timestamps remain the compatibility boundary even if each port organizes that calculation differently.

## Values and coordinates

- Tide heights, tide amplitudes, fixed subordinate height offsets, and `Station.offset` are metres.
- Tide rates are metres per hour.
- Current amplitudes, mean-flow offsets, and results are knots. Positive current is flood and negative current is ebb.
- Angles, constituent phases, and current directions are degrees. Angles wrap at 360 degrees.
- Station lookup is outside the harmonic engine. The TypeScript database accepts decimal latitude and longitude, with north and east positive. The Swift and Kotlin engines accept station constants directly and have no coordinate API.

## Datums

The harmonic sum is relative to mean sea level. All low-level engines accept a bare additive offset supplied by the caller; no low-level engine resolves a named datum.

The TypeScript `useStation` wrapper resolves a requested datum as `MSL - datum` and then applies that offset to the prediction. It defaults to the station's chart datum when available and can convert the final height from metres to feet. Swift and Kotlin callers perform the same lookup and unit conversion before constructing `Station`. Swift `Station.offset` and Kotlin `Station.offsetMetres` are therefore additive values in metres, not a datum identifier.

Subordinate tide height corrections are either a ratio applied to the reference height above chart datum or a fixed value in metres. For a ratio subordinate, `useStation` predicts in the chart datum and adds `chart datum - datum` after applying the ratio, and throws if the chart datum is missing from the station's datums. Swift and Kotlin callers construct the reference `Station` with its chart-datum offset and add the same difference to the subordinate's results. TypeScript subordinate time offsets are minutes in `ExtremeOffsets`; Swift initializer offsets are `TimeInterval` values in seconds.

Subordinate current time adjustments are seconds in all low-level engines (`SubordinateCurrentOptions` and the Swift initializer). NOAA and the station database publish them in minutes; the TypeScript station layer converts. A TypeScript event's per-day search covers whole UTC days with an 8-hour margin, so an event list never depends on the requested window.

## Public API correspondence

| Capability                  | TypeScript                                                         | Swift                                                     | Kotlin                                                |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------- |
| Harmonic tide station       | `createTidePredictor` or `useStation`                              | `Station`                                                 | `Station`                                             |
| Timeline heights            | `getTimelinePrediction`                                            | `Station.heights(from:to:step:)`                          | `Station.heights`                                     |
| Height at one instant       | `getWaterLevelAtTime`                                              | —                                                         | —                                                     |
| High and low waters         | `getExtremesPrediction`                                            | `Station.extremes(from:to:)`                              | `Station.extremes`                                    |
| Tide rate                   | —                                                                  | `Station.rates(from:to:step:)`                            | `Station.rates`                                       |
| Subordinate tide station    | `ExtremeOffsets` passed to prediction                              | `SubordinateTideStation`                                  | `SubordinateTideStation`                              |
| Harmonic current station    | `createCurrentPredictor` or `useCurrentStation`                    | `CurrentStation`                                          | `CurrentStation`                                      |
| Current speed and events    | `CurrentPredictor.getTimelinePrediction` and `getEventsPrediction` | `CurrentStation.speeds`, `slacks`, `maxima`, and `events` | `CurrentStation.speeds`, `slacks`, `maxima`, `events` |
| Subordinate current station | `createSubordinateCurrentPredictor`                                | `SubordinateStation`                                      | `SubordinateCurrentStation`                           |
| Extreme ranking             | —                                                                  | `TideExtreme.ranges`, `percentileRank`, and `percentile`  | —                                                     |
| Tide-derived slack          | —                                                                  | `DerivedSlackStation`                                     | —                                                     |

API names and return shapes do not need to match across languages. Units, signs, event kinds, and numerical results do.

Kotlin time offsets and steps are seconds. Kotlin current events crop covering UTC-day results to the requested bounds; TypeScript returns the whole covering days. The harmonic current parity fixture includes events beyond its nominal end, so Kotlin compares the fixture's full event span. Kotlin harmonic tide extrema retain Swift's outward 600-second search grid. Kotlin uses TypeScript's Illinois derivative root refinement for curve parity; Swift's bisection can shift times by a fraction of a second within the shared tolerance. Kotlin current directions are optional and present only at maxima with a published direction.

Kotlin subordinate tide and current curves expand their event context until corrected knots bracket both timeline boundaries. Expansion is bounded by the longest active constituent period. At each context a tide curve uses the reference's raw turning points when its filtered extremes don't bracket the timeline, as Swift does at its fixed 15-hour pad; an unresolved curve from an oscillating reference fails explicitly. Non-oscillating empty event tables retain their zero curves. Kotlin subordinate slack reduction extends its following-phase context for short queries when needed, up to the longest active constituent period, and fails explicitly if the required phase remains unavailable.

## Shared edge cases

- Unknown constituent names and zero-amplitude constituents contribute nothing to the harmonic sum.
- Constituent aliases such as NOAA `NU2` resolve to the same canonical constituent as their Slackwater name.
- Angular comparisons use circular distance so values on opposite sides of 0/360 degrees can agree.
- High water is a local maximum and low water is a local minimum. Flood and ebb current events are classified from the sign of velocity, not from alternating labels.
- Fixed subordinate corrections add to height; ratio corrections multiply height. Unequal high and low time corrections may reorder events, so results are returned in time order.
- A subordinate current uses the offset for the phase following each slack: slack-before-flood or slack-before-ebb.
- Some current stations publish no flood or ebb direction. TypeScript takes directions as optional and leaves `direction` off events for a phase without one, because 0 would read as due north. Swift current events carry no direction, and the Swift `CurrentStation` and `SubordinateStation` initializers require one, so a Swift caller without a published direction passes a placeholder and must not display it.
- Current validation applies strict event tolerances only at navigationally significant speeds of at least 0.75 kn. Weak, nearly flat extrema have unstable event times and are reported without gating the suite.

## Cross-port parity

These gates compare Swift and Kotlin results with fixtures generated from the TypeScript workspace package.

| Area             | Comparison                      | Tolerance                                   |
| ---------------- | ------------------------------- | ------------------------------------------- |
| Astronomy        | Mean longitudes and node angles | `< 1e-6°` circular difference               |
| Node corrections | IHO `f` and `u`                 | `< 1e-6` for `f`; `< 1e-6°` for `u`         |
| Constituents     | `V0`, compound `f`, and `u`     | `< 1e-6`                                    |
| Tide timeline    | Timestamp and height            | `< 0.5 s`; maximum height error `< 1e-6 m`  |
| Current timeline | Timestamp and signed speed      | `< 0.5 s`; maximum speed error `< 1e-6 kn`  |
| Current events   | Count, kind, time, and speed    | Count and kind exact; `< 60 s`; `< 0.02 kn` |
| Tide extremes    | Count, kind, time, and height   | Count and kind exact; `< 60 s`; `< 0.02 m`  |

## Physical accuracy

These gates compare the Swift and Kotlin implementations with checked-in NOAA CO-OPS predictions. They measure model accuracy rather than language parity.

| Area                           | Stations                                        | Tolerance               | Swift observed maximum |
| ------------------------------ | ----------------------------------------------- | ----------------------- | ---------------------- |
| Harmonic tides                 | Friday Harbor 9449880                           | `< 15 min`; `< 0.15 m`  | `7.9 min`; `0.035 m`   |
| Subordinate tides              | Nurse Channel TEC4635 and Kamalo Harbor 1613077 | `< 15 min`; `< 0.15 m`  | `2.8 min`; `0.008 m`   |
| Harmonic currents              | PUG1741                                         | `< 20 min`; `< 0.30 kn` | `9.7 min`; `0.055 kn`  |
| Significant home-pass currents | Six Salish Sea stations, events `>= 0.75 kn`    | `< 20 min`; `< 0.35 kn` | `15.3 min`; `0.278 kn` |
| Subordinate currents           | PCT0236 and nine-station batch                  | `< 30 min`; `< 0.40 kn` | `7.7 min`; `0.101 kn`  |

## What a ranking window can claim

`percentileRank` will rank anything handed to it. What the result _means_ depends on the window, and the two kinds of claim a window supports do not have the same requirement.

**A claim about level** — "the lowest low of the year", or any distance to LAT or HAT — needs the seasonal terms. Sa and Ssa raise and lower mean sea level across the year, so without them a year-long window returns two confident numbers that do not mean what the sentence would claim. Gate those on a non-zero `Sa` or `Ssa`, never on the data source.

**A claim about range** — "when does the water here run widest", "is this swing beyond normal" — does not inherently require Sa/Ssa. For a monthly span, the seasonal offset is often nearly common to the month's extrema, while the seasonal pattern primarily comes from the solar and declinational structure present in the fitted basis.

Measured over `@slackwater/database`'s NOAA harmonic sets, monthly span (highest high − lowest low) across 2026:

| Station       | has LAT/HAT | max/min span |
| ------------- | ----------- | ------------ |
| Friday Harbor | yes         | 1.43×        |
| Chignik       | **no**      | **1.24×**    |
| Portland ME   | yes         | 1.16×        |
| Winterport    | **no**      | 1.15×        |

All four peak near the solstices and trough in September, and the stations without the annual constituent are not the weaker signal. The same holds for currents, which matters more there: only 5 of 855 NOAA current reference stations carry a non-zero `Sa` or `Ssa`, but their 25-term sets carry the declination, so a seasonal _range_ question is answerable at all of them.

A consumer that gates a range claim on the annual constituent will hide it at every station fitted from a short series — every CHS on-device fit, and about a fifth of NOAA's harmonic references. slackwater-ios shipped that mistake and reverted it (openwatersio/slackwater-ios#640, #641).

## Intentional asymmetry

| Area                                                | TypeScript | Swift | Kotlin |
| --------------------------------------------------- | ---------- | ----- | ------ |
| Harmonic prediction, extremes, and node corrections | yes        | yes   | yes    |
| Subordinate tide stations                           | yes        | yes   | yes    |
| Currents, including subordinate reduction           | yes        | yes   | yes    |
| Extreme ranking against a station's history         | —          | yes   | —      |
| Slack derived from a tide reference's lag           | —          | yes   | —      |

Asymmetric features remain outside the parity gates. They enter the shared contract when participating ports implement them and a common fixture can exercise them. `fixtures/currents-parity.json` is generated from the TypeScript engine and carries the current timeline and event vectors for Swift and Kotlin parity gates; all three ports already share the NOAA golden current fixtures and their physical-accuracy tolerances above.
