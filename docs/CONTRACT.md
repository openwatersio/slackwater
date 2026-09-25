# Engine contract

The TypeScript and Swift engines implement the same harmonic tide model. The fixtures in `fixtures/` define their shared numerical contract. Each language may expose an idiomatic API, but changes to the model, conventions, or shared results must update this document and the fixtures in the same pull request.

## Time

- Inputs and outputs are absolute instants. TypeScript uses `Date`; Swift uses `Foundation.Date`.
- Fixture timestamps are ISO 8601 UTC strings ending in `Z`. Engines must not apply a local time zone during prediction.
- Constituent phase is relative to GMT. Current constituents use NOAA `majorPhaseGMT`.
- Timeline sampling floors the start and ceils the end to the requested step, including both resulting timestamps. Event searches return detected roots inside the search window; roots exactly on a boundary are not guaranteed. Timeline steps are seconds in Swift, and TypeScript uses the same unit for `timeFidelity`.
- Node corrections are recalculated through long prediction windows. Results at the fixture timestamps remain the compatibility boundary even if each port organizes that calculation differently.

## Values and coordinates

- Tide heights, tide amplitudes, fixed subordinate height offsets, and `Station.offset` are metres.
- Tide rates are metres per hour.
- Current amplitudes, mean-flow offsets, and results are knots. Positive current is flood and negative current is ebb.
- Angles, constituent phases, and current directions are degrees. Angles wrap at 360 degrees.
- Station lookup is outside the harmonic engine. The TypeScript database accepts decimal latitude and longitude, with north and east positive. The Swift engine accepts station constants directly and has no coordinate API.

## Datums

The harmonic sum is relative to mean sea level. Both low-level engines accept a bare additive offset supplied by the caller; neither low-level engine resolves a named datum.

The TypeScript `useStation` wrapper resolves a requested datum as `MSL - datum` and then applies that offset to the prediction. It defaults to the station's chart datum when available and can convert the final height from metres to feet. Swift callers perform the same lookup and unit conversion before constructing `Station`. A Swift `Station.offset` is therefore an additive value in metres, not a datum identifier.

Subordinate tide height corrections are either a ratio applied to the reference height or a fixed value in metres. TypeScript subordinate time offsets are minutes in `ExtremeOffsets`; Swift initializer offsets are `TimeInterval` values in seconds.

Subordinate current time adjustments are seconds in both low-level engines (`SubordinateCurrentOptions` and the Swift initializer). NOAA and the station database publish them in minutes; the TypeScript station layer converts. A TypeScript event's per-day search covers whole UTC days with an 8-hour margin, so an event list never depends on the requested window.

## Public API correspondence

| Capability                  | TypeScript                                                         | Swift                                                     |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Harmonic tide station       | `createTidePredictor` or `useStation`                              | `Station`                                                 |
| Timeline heights            | `getTimelinePrediction`                                            | `Station.heights(from:to:step:)`                          |
| Height at one instant       | `getWaterLevelAtTime`                                              | —                                                         |
| High and low waters         | `getExtremesPrediction`                                            | `Station.extremes(from:to:)`                              |
| Tide rate                   | —                                                                  | `Station.rates(from:to:step:)`                            |
| Subordinate tide station    | `ExtremeOffsets` passed to prediction                              | `SubordinateTideStation`                                  |
| Harmonic current station    | `createCurrentPredictor` or `useCurrentStation`                    | `CurrentStation`                                          |
| Current speed and events    | `CurrentPredictor.getTimelinePrediction` and `getEventsPrediction` | `CurrentStation.speeds`, `slacks`, `maxima`, and `events` |
| Subordinate current station | `createSubordinateCurrentPredictor`                                | `SubordinateStation`                                      |
| Extreme ranking             | —                                                                  | `TideExtreme.ranges`, `percentileRank`, and `percentile`  |
| Tide-derived slack          | —                                                                  | `DerivedSlackStation`                                     |

API names and return shapes do not need to match across languages. Units, signs, event kinds, and numerical results do.

## Shared edge cases

- Unknown constituent names and zero-amplitude constituents contribute nothing to the harmonic sum.
- Constituent aliases such as NOAA `NU2` resolve to the same canonical constituent as their Slackwater name.
- Angular comparisons use circular distance so values on opposite sides of 0/360 degrees can agree.
- High water is a local maximum and low water is a local minimum. Flood and ebb current events are classified from the sign of velocity, not from alternating labels.
- Fixed subordinate corrections add to height; ratio corrections multiply height. Unequal high and low time corrections may reorder events, so results are returned in time order.
- A subordinate current uses the offset for the phase following each slack: slack-before-flood or slack-before-ebb.
- Current validation applies strict event tolerances only at navigationally significant speeds of at least 0.75 kn. Weak, nearly flat extrema have unstable event times and are reported without gating the suite.

## Cross-port parity

These gates compare Swift results with fixtures generated from the TypeScript workspace package.

| Area             | Comparison                      | Tolerance                                  |
| ---------------- | ------------------------------- | ------------------------------------------ |
| Astronomy        | Mean longitudes and node angles | `< 1e-6°` circular difference              |
| Node corrections | IHO `f` and `u`                 | `< 1e-6` for `f`; `< 1e-6°` for `u`        |
| Constituents     | `V0`, compound `f`, and `u`     | `< 1e-6`                                   |
| Tide timeline    | Timestamp and height            | `< 0.5 s`; maximum height error `< 1e-6 m` |
| Tide extremes    | Count, kind, time, and height   | Count and kind exact; `< 60 s`; `< 0.02 m` |

## Physical accuracy

These gates compare the Swift implementation with checked-in NOAA CO-OPS predictions. They measure model accuracy rather than language parity.

| Area                           | Stations                                        | Tolerance               | Current observed maximum |
| ------------------------------ | ----------------------------------------------- | ----------------------- | ------------------------ |
| Harmonic tides                 | Friday Harbor 9449880                           | `< 15 min`; `< 0.15 m`  | `7.9 min`; `0.035 m`     |
| Subordinate tides              | Nurse Channel TEC4635 and Kamalo Harbor 1613077 | `< 15 min`; `< 0.15 m`  | `2.8 min`; `0.008 m`     |
| Harmonic currents              | PUG1741                                         | `< 20 min`; `< 0.30 kn` | `9.7 min`; `0.055 kn`    |
| Significant home-pass currents | Six Salish Sea stations, events `>= 0.75 kn`    | `< 20 min`; `< 0.35 kn` | `15.3 min`; `0.278 kn`   |
| Subordinate currents           | PCT0236 and nine-station batch                  | `< 30 min`; `< 0.40 kn` | `7.7 min`; `0.101 kn`    |

## Intentional asymmetry

| Area                                                | TypeScript | Swift |
| --------------------------------------------------- | ---------- | ----- |
| Harmonic prediction, extremes, and node corrections | yes        | yes   |
| Subordinate tide stations                           | yes        | yes   |
| Currents, including subordinate reduction           | yes        | yes   |
| Extreme ranking against a station's history         | —          | yes   |
| Slack derived from a tide reference's lag           | —          | yes   |

Asymmetric features remain outside the parity gates. They enter the shared contract when both ports implement them and a common fixture can exercise them. `fixtures/currents-parity.json` is generated from the TypeScript engine and carries the current timeline and event vectors for a Swift parity gate; both ports already share the NOAA golden current fixtures and their physical-accuracy tolerances above.
