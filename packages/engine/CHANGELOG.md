# @neaps/tide-predictor

## 1.0.0-beta.3

### Patch Changes

- [#366](https://github.com/openwatersio/slackwater/pull/366) [`7719470`](https://github.com/openwatersio/slackwater/commit/77194704cc28d98272e38c61d52e50ca41d0c799) Thanks [@clarkbw](https://github.com/clarkbw)! - Fix extremes predictions that list two highs or two lows in a row. The spurious-extreme filter removes a sub-threshold low and high together, so it never leaves two of a kind side by side, and a shallow double high water reports the higher of its two highs. Extremes near the start and end of a window are judged against the tide beyond it, so a short window reports the same extremes as a longer one.

- [#367](https://github.com/openwatersio/slackwater/pull/367) [`95c1fe3`](https://github.com/openwatersio/slackwater/commit/95c1fe3978549e47063a3a28e5669ef65b958100) Thanks [@clarkbw](https://github.com/clarkbw)! - Apply ratio subordinate height offsets to the height above chart datum, so a ratio subordinate predicts the same tide in every datum. A ratio subordinate whose chart datum is missing from its datums now throws.

- [#365](https://github.com/openwatersio/slackwater/pull/365) [`c97fa13`](https://github.com/openwatersio/slackwater/commit/c97fa1326432edd788ea358a81daa2af7480cb59) Thanks [@clarkbw](https://github.com/clarkbw)! - Predict TICON's 3N2 on its own line at 28.4350877°/h with a 90° phase constant instead of folding it into MKS2.

- [#368](https://github.com/openwatersio/slackwater/pull/368) [`36b698c`](https://github.com/openwatersio/slackwater/commit/36b698c4652b5e16f72313e5c7f0962c3f6b131e) Thanks [@clarkbw](https://github.com/clarkbw)! - `getWaterLevelAtTime` returns the water level at the requested time instead of at the preceding 10-minute mark.

## 1.0.0-beta.2

### Minor Changes

- [#341](https://github.com/openwatersio/slackwater/pull/341) [`0d41099`](https://github.com/openwatersio/slackwater/commit/0d4109957462b7a2de9af313eea36eba5dab1045) Thanks [@clarkbw](https://github.com/clarkbw)! - Add full-rank harmonic fitting for heights and signed velocities, with per-sample astronomy and shared Swift parity fixtures.

## 1.0.0-beta.1

### Major Changes

- [#339](https://github.com/openwatersio/slackwater/pull/339) [`8fc2e6f`](https://github.com/openwatersio/slackwater/commit/8fc2e6f585ccdb6bea9117230d8fed7c69b158d2) Thanks [@bkeepers](https://github.com/bkeepers)! - Neaps is now Slackwater. `neaps` is `slackwater`, `@neaps/tide-predictor` is `@slackwater/engine`, and the CLI, API, and React packages move to the `@slackwater` scope. The CLI command is `slackwater`, and `install.sh` reads `SLACKWATER_VERSION` and `SLACKWATER_INSTALL_DIR`. The Swift library product is `SlackwaterKit`. Station data comes from `@slackwater/database`, which replaces `@neaps/tide-database`.

  Breaking changes beyond the names:

  - `@slackwater/engine` drops its deprecated default export and `createTidePredictor.constituents`. Import `createTidePredictor` and `constituents` by name. `ExtremesInput` no longer accepts `timeFidelity`.
  - `@slackwater/react` renames `NeapsProvider` and `useNeapsConfig` to `SlackwaterProvider` and `useSlackwaterConfig`, and its CSS variables from `--neaps-*` to `--slackwater-*`.

### Minor Changes

- [#340](https://github.com/openwatersio/slackwater/pull/340) [`5b40865`](https://github.com/openwatersio/slackwater/commit/5b40865277dd6a5696250c6953d1579a9820a035) Thanks [@bkeepers](https://github.com/bkeepers)! - Upgrade to @neaps/tide-database 0.10, which adds current stations to the database. Station lookups and predictions filter to tide stations, and `Station.disclaimers` is now optional.

### Patch Changes

- [#340](https://github.com/openwatersio/slackwater/pull/340) [`afab97b`](https://github.com/openwatersio/slackwater/commit/afab97bda2bdbad8736fc5779d3736afba69340d) Thanks [@bkeepers](https://github.com/bkeepers)! - Recognize the five harmonic constituent variants published by Kartverket.

## 0.11.0

### Minor Changes

- [#301](https://github.com/openwatersio/neaps/pull/301) [`36a0b23`](https://github.com/openwatersio/neaps/commit/36a0b23a3f9b69fa52efc59cc62b877b0f90c7db) Thanks [@bkeepers](https://github.com/bkeepers)! - Drop the CommonJS builds; all neaps packages are now ESM-only. The CJS entries
  can't survive their dependencies going ESM-only, since they load them with
  `require()`. CommonJS consumers on Node 20.19+ / 22.12+ can still `require()`
  these packages via Node's `require(esm)` support.

## 0.10.0

### Minor Changes

- [#198](https://github.com/openwatersio/neaps/pull/198) [`cd1341b`](https://github.com/openwatersio/neaps/commit/cd1341bc44e63398273dab4d2960c1437a15e518) Thanks [@bkeepers](https://github.com/bkeepers)! - Moved `useStation` into @neaps/tide-predictor so it can be used without the heavy dependency of @neaps/tide-database.

  Subordinate stations now use the `datums` and `harmonic_constituents` included in @neaps/tide-database 0.8 instead of resolving them from the reference station at prediction time.

## 0.9.0

### Minor Changes

- [#220](https://github.com/openwatersio/neaps/pull/220) [`c1f0144`](https://github.com/openwatersio/neaps/commit/c1f014473b63d0720f0f313b4c9d6b1b50d00a72) Thanks [@bkeepers](https://github.com/bkeepers)! - Filter spurious extremes from tide predictions using prominence threshold and minimum temporal gap criteria.

### Patch Changes

- [#234](https://github.com/openwatersio/neaps/pull/234) [`6feeca0`](https://github.com/openwatersio/neaps/commit/6feeca09bed1be0dde7b529965427655db004fbe) Thanks [@bkeepers](https://github.com/bkeepers)! - Align timeline predictions to clock boundaries based on `timeFidelity`. For example, with the default timeFidelity of 600 seconds, predictions now fall on :00, :10, :20, :30, :40, :50 past the hour regardless of the requested start time. The start time will always snap to the previous clock boundary, and the end time will snap to the next clock boundary.

- [#257](https://github.com/openwatersio/neaps/pull/257) [`ccb662f`](https://github.com/openwatersio/neaps/commit/ccb662ff1742fcd504b8dcbdf876781a96ca4e71) Thanks [@bkeepers](https://github.com/bkeepers)! - Fix incorrect division for milleseconds in JD function (Thanks @dartheditous)

- [#253](https://github.com/openwatersio/neaps/pull/253) [`764b8c0`](https://github.com/openwatersio/neaps/commit/764b8c0dd0fb07bad272fcc4a39f6bd1af97814a) Thanks [@bkeepers](https://github.com/bkeepers)! - Update T3, R3, 3N2, and 3L2 constituent definitions from TICON manual

## 0.8.0

### Minor Changes

- [#227](https://github.com/openwatersio/neaps/pull/227) [`b3efa7c`](https://github.com/openwatersio/neaps/commit/b3efa7cf2460f5f21e490b42f81782878f65d7ed) Thanks [@bkeepers](https://github.com/bkeepers)! - Add support for timeline predictions with offsets.

  `getTimelinePrediction` now accepts an `offsets` option for subordinate stations, using proportional domain-mapping to interpolate between reference station extremes with time and height adjustments.

## 0.7.0

### Minor Changes

- [#213](https://github.com/openwatersio/neaps/pull/213) [`9f3fdf6`](https://github.com/openwatersio/neaps/commit/9f3fdf6785492a97dae717a6257c5358fc661e07) Thanks [@bkeepers](https://github.com/bkeepers)! - Speed up extremes detection by ~100x, deprecate `timeFidelity` option on `getExtremesPrediction`, which will always be <1s now.

## 0.6.0

### Minor Changes

- [#208](https://github.com/openwatersio/neaps/pull/208) [`355f696`](https://github.com/openwatersio/neaps/commit/355f6960af6fc6cd9a5c3d592b5303bb0e4485e9) Thanks [@bkeepers](https://github.com/bkeepers)! - Replace constituent definitions with the [IHO TWCWG (International Hydrographic Organization Tidal and Water Level Working Group) constituent list](https://github.com/openwatersio/neaps/blob/main/docs/TWCWG_Constituent_list.md).

  There are lot of implementation details that changed, but the highlights are:
  1. Switched from ~60 hand-coded constituents to 395 IHO standard constituents (6.6x increase).
  2. Switched to IHO standard nodal correction formulas described in Annex A, which use simplified Fourier series formulas and are the International standard used by hydrographic offices worldwide.
  3. Implemented the IHO Annex B rules for resolving compound constituent members. This allows for much more comprehensive tidal predictions that include minor constituents that can have significant local effects.

  ## Benchmark Results

  Most importantly, the new implementation delivers significantly improved accuracy when comparing predictions to NOAA, with a 60% reduction in median height error (22.3mm to 8.7mm) and a 60% reduction in timing error (15 min to 6 min) at the 95th percentile.

  | Metric                                     | Before  | After       | Improvement |
  | ------------------------------------------ | ------- | ----------- | ----------- |
  | **Median height error (MAE p50)**          | 22.3 mm | **8.7 mm**  | **↓ 60.9%** |
  | **95th percentile height error (MAE p95)** | 45.4 mm | **23.9 mm** | **↓ 47.4%** |
  | **RMSE (median)**                          | 25.4 mm | **10.3 mm** | **↓ 59.6%** |
  | **Median timing error (p95)**              | 15 min  | **6 min**   | **↓ 60.0%** |

- [#212](https://github.com/openwatersio/neaps/pull/212) [`ebb5dc0`](https://github.com/openwatersio/neaps/commit/ebb5dc02c9e4123bf6bd0ed4fd70531a5aa7eb79) Thanks [@bkeepers](https://github.com/bkeepers)! - Export constituents, deprecate default export

  ```diff
  -import tidePredictor from "@neaps/tide-predictor";
  +import { createTidePredictor } from "@neaps/tide-predictor";
  ```

## 0.5.0

### Minor Changes

- Add constituents to support TICON data #186

### Patch Changes

- Add MP1 constituent
