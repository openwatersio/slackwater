# Slackwater for Swift

The open, offline tide & current engine behind **Slackwater** — *Offline Tides & Currents*.

Tide prediction is deterministic astronomy, not a live feed. Given a station's harmonic
constituents you can compute heights and the high/low turns for any minute, years ahead,
with **zero network**. This package is a pure-Swift harmonic engine that does exactly that.

**It's all open — the engine MIT, the app GPL v3.** If you sail somewhere our numbers are
off, read the code, check it against your home waters, and send a fix.

## Status

- **Tides** — validated against the Slackwater reference (floating-point agreement across every
  layer) and NOAA's own published predictions (**Friday Harbor: max 7.9 min / 3.5 cm**).
  Subordinate stations reduce from their reference within **2.8 min / 0.8 cm** of NOAA
  (Nurse Channel, ratio; Kamalo Harbor, fixed). See [`docs/validation/phase0-report.md`](docs/validation/phase0-report.md).
- **Currents** — US NOAA current stations (harmonic + subordinate), constituents sourced
  straight from NOAA CO-OPS, computed offline. Validated against NOAA's own current
  predictions: **PUG1741 (Bellingham Channel) 9.7 min / 0.055 kn**, subordinate reduction
  **6.1 min / 0.05 kn**, and the Salish Sea passes (Deception Pass, Rosario, San Juan
  Channel, Turn Point, Admiralty, Race Rocks) directly. See
  [`docs/validation/currents-report.md`](docs/validation/currents-report.md).

## Use

### Tides

```swift
import SlackwaterKit

let station = Station(
    constituents: [HarmonicConstituent(name: "M2", amplitude: 0.96, phase: 128) /* … */],
    offset: 1.387  // datum offset (e.g. MSL → MLLW), optional
)
let heights  = station.heights(from: start, to: end, step: 600)   // [TidePoint]
let extremes = station.extremes(from: start, to: end)             // [TideExtreme] high/low

// A subordinate station has no constituents: NOAA time and height corrections
// against a reference's highs and lows, with a half-cosine curve between.
let sub = SubordinateTideStation(
    reference: station,
    highTimeOffset: 0, lowTimeOffset: 10 * 60,       // seconds
    height: .ratio(high: 0.79, low: 1.11)            // or .fixed(high:low:) in metres
)
sub.heights(from: start, to: end); sub.extremes(from: start, to: end); sub.rates(from: start, to: end)
```

Harmonic constants come from public sources — NOAA (public domain, bundled) and, online,
CHS/IWLS for Canadian waters.

Clients can construct `TidePoint(time:height:)`, `TideRatePoint(time:rate:)`, and `TideExtreme(time:height:kind:)` from downloaded predictions for their own sampled-data views. Heights are in meters and rates are in meters per hour; interpolation, event detection, and coverage checks belong to the client.

### Currents

Signed major-axis velocity (knots), plus slack / max-flood / max-ebb events. The engine
carries no station catalog — supply the constants and build a station:

```swift
import SlackwaterKit

let dp = CurrentStation(
    constituents: [HarmonicConstituent(name: "M2", amplitude: 5.21, phase: 241.2) /* … */],
    floodDirection: 92.9,   // NOAA `azi`
    ebbDirection: 272.9,
    offset: -0.62           // NOAA `majorMeanSpeed` (mean flow), optional
)
let speeds = dp.speeds(from: start, to: end)   // [CurrentPoint], signed knots (+flood / -ebb)
let slacks = dp.slacks(from: start, to: end)   // slack water (velocity value-zeros)
let maxima = dp.maxima(from: start, to: end)   // max flood / max ebb, labeled by velocity sign
```

Subordinate stations (`SubordinateStation`) warp a reference station's events by NOAA's
two-slack / speed-ratio offsets. `speeds(from:to:step:)` draws a half-cosine through those
events, on the same timeline as a harmonic station's — NOAA publishes no curve for a
subordinate, so it is a drawing of the table, not a prediction between its rows.

### Harmonic fitting

`fit(samples:constituents:)` fits an offset and a fixed list of constituents to heights or signed current velocities. Available on macOS 13, iOS 16, and watchOS 9.

```swift
let fitted = try fit(samples: samples, constituents: ["M2", "S2", "K1", "O1"])
let station = Station(constituents: fitted.constituents, offset: fitted.offset)
```

Samples are `HarmonicSample(time:value:)`, finite and ordered by time, with at least `max(2, 1 + 2 * constituents.count)` entries spanning a positive duration. Repeated timestamps retain their weight, including overlapping fetch boundaries. Unknown names, duplicate aliases, and rank-deficient bases throw `HarmonicFitError`. The fit uses Accelerate QR least squares with equilibrium arguments and IHO nodal corrections evaluated at every sample. `rms` measures training residuals; `unseparable` reports Rayleigh pairs without dropping them. Callers choose the basis and validate on held-out samples. In particular, SA/SSA should not be added to CHS 60-day fits.

The synthetic inputs in `fixtures/harmonic-fit.json` cover 60- and 210-day windows and retain the frozen CHS fitter outputs for historical comparison. The current shared oracle is `fixtures/harmonic-fit-parity.json`, generated independently with SVD and per-sample astronomy by `node fixtures/generate/gen-fit.mjs`. Swift and [`@slackwater/engine`](../packages/engine#harmonic-fitting) check coefficients, offset, RMS, Rayleigh warnings, and the same invalid-input fixtures. No CHS observations are included.

The catalog entries `3(SM)N2`, `(SK)K5`, `4ML12`, and `5MSN12` lack equilibrium-argument definitions and are rejected as `rankDeficient`. A catalog speed alone does not define their Greenwich phase.

## Develop

```sh
swift test                                  # golden + NOAA-oracle validation
npm run fixtures:check                      # regenerate in memory and fail on drift
node fixtures/generate/gen-golden.mjs       # regenerate tide golden fixtures from workspace source
node fixtures/generate/gen-catalog.mjs      # regenerate the bundled tide constituent catalog
node fixtures/generate/gen-realworld.mjs    # refresh the NOAA tide real-world fixture
```

> **Current-station data is not extracted here.** The extractor, the schema, and the
> NOAA API's undocumented behaviour live in
> [noaa-current-stations](https://github.com/openwatersio/noaa-current-stations) — shared with
> the SignalK plugin so the `currbin` / per-bin-reference / type-S traps stay solved in
> one place. This engine consumes station constants a caller supplies and stays offline.
>
> ```sh
> npx --package=@openwaters/noaa-current-stations@0.4.0 noaa-current-stations golden <out.json> --station ID --bin N --start ISO --end ISO
> ```
> regenerates a NOAA currents oracle fixture.

## Layout

`Package.swift` sits at the repository root because SwiftPM resolves only a root manifest — it has no subdirectory-package support. The targets reach into `swift/` with explicit paths:

```swift
.target(name: "SlackwaterKit", path: "swift/Sources/SlackwaterKit"),
.testTarget(name: "SlackwaterKitTests", dependencies: ["SlackwaterKit"], path: "swift/Tests/SlackwaterKitTests"),
```

Both the Swift and TypeScript suites read the shared `fixtures/` corpus directly, with no copying and no test resources: TypeScript resolves it relative to `import.meta.url`, Swift relative to `#filePath`. That one trick is what makes a single corpus serve two languages.

The module is named `SlackwaterKit` — not `Slackwater` — because the iOS app's own module owns that name, and two modules with one name cannot coexist in the same build.

## Releases

The Swift engine versions independently of the npm packages, and the fixtures are what hold the two implementations together. Changesets owns the npm-style tags (`@slackwater/engine@x.y.z`), and SwiftPM ignores every one of them because it recognises only bare `X.Y.Z` and `vX.Y.Z` — so Swift releases take the `vX.Y.Z` namespace, which nothing else uses. Parity between the ports is enforced by the fixtures and [`docs/CONTRACT.md`](../docs/CONTRACT.md), not by matching version numbers.

A `smoke-swiftpm` workflow runs on every `v*` tag push: it builds a scratch consumer package against the public repository URL at that exact tag, proving resolution before any real consumer cuts over. The `protect-release-tags` ruleset covers `refs/tags/v*` and `refs/tags/*@*` together, blocking deletion and non-fast-forward while leaving tag creation open.

## Credit & licence

The harmonic algorithm is a faithful Swift port of
[openwatersio/slackwater](https://github.com/openwatersio/slackwater), and station data
comes from [`@slackwater/database`](https://github.com/openwatersio/slackwater-database). Huge
thanks to that project.

MIT — see [LICENSE](LICENSE).

> **Not for navigation.** Predictions are astronomical estimates and do not account for
> weather, surge, or local effects. Carry official tables and charts.
