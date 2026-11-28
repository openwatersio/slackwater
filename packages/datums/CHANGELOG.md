# @slackwater/datums

## 0.1.0-beta.1

### Patch Changes

- [#577](https://github.com/openwatersio/slackwater/pull/577) [`1d798fc`](https://github.com/openwatersio/slackwater/commit/1d798fcb428ed78dbcfad3fb0a7b459afd78223b) Thanks [@bkeepers](https://github.com/bkeepers)! - Fix `computeDatumsFromObservations` throwing "Cannot set properties of undefined" on a record with almost no tide, such as a Great Lakes gauge, where two high or low waters are read out of time order. At such a record the once-a-day designation of higher highs and lower lows now searches every tide, as NOAA's Tidal Analysis Datum Calculator does, apart from the departures the package README lists, so its MHHW and MLLW can change.
- Updated dependencies [[`3361a3d`](https://github.com/openwatersio/slackwater/commit/3361a3de4f8ad98fe1f0b6e6d1d07eb047434e81)]:
  - @slackwater/engine@1.0.0-beta.16

## 0.1.0-beta.0

### Minor Changes

- [#570](https://github.com/openwatersio/slackwater/pull/570) [`02d36af`](https://github.com/openwatersio/slackwater/commit/02d36aff574426b25f5cdd2336f0fa601185810d) Thanks [@bkeepers](https://github.com/bkeepers)! - Compute tidal datums from harmonic constants or from observed water levels with the new `@slackwater/datums` package: mean high and low waters, mean sea level, the astronomical tide bounds over a pinned 19-year epoch, Canada's Large Tide levels, China's Theoretical Lowest Tide by GB 12327-2022, and the spring and Indian Spring low waters. Observed high and low waters are tabulated after NOAA's Tidal Analysis Datum Calculator, and every prediction takes the nodal corrections the constants were fitted under.

### Patch Changes

- Updated dependencies [[`e0a65bf`](https://github.com/openwatersio/slackwater/commit/e0a65bf8ac0ad05b03c62c30cc01372772f5e47d), [`e0a65bf`](https://github.com/openwatersio/slackwater/commit/e0a65bf8ac0ad05b03c62c30cc01372772f5e47d), [`07b0eed`](https://github.com/openwatersio/slackwater/commit/07b0eed902565b63deb1707b66ad6e6350102a5a)]:
  - @slackwater/engine@1.0.0-beta.15
