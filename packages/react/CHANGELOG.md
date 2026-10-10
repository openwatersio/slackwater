# @neaps/react

## 1.0.0-beta.2

### Patch Changes

- [#383](https://github.com/openwatersio/slackwater/pull/383) [`63efbad`](https://github.com/openwatersio/slackwater/commit/63efbad5cadf10cc1b9db69e500379725936013f) Thanks [@bkeepers](https://github.com/bkeepers)! - Package descriptions, keywords, and homepages present each package as part of the Slackwater family, with the docs at https://openwaters.io/tides/slackwater/. `slackwater` ships a README on npm.

## 1.0.0-beta.1

### Major Changes

- [#339](https://github.com/openwatersio/slackwater/pull/339) [`8fc2e6f`](https://github.com/openwatersio/slackwater/commit/8fc2e6f585ccdb6bea9117230d8fed7c69b158d2) Thanks [@bkeepers](https://github.com/bkeepers)! - Neaps is now Slackwater. `neaps` is `slackwater`, `@neaps/tide-predictor` is `@slackwater/engine`, and the CLI, API, and React packages move to the `@slackwater` scope. The CLI command is `slackwater`, and `install.sh` reads `SLACKWATER_VERSION` and `SLACKWATER_INSTALL_DIR`. The Swift library product is `SlackwaterKit`. Station data comes from `@slackwater/database`, which replaces `@neaps/tide-database`.

  Breaking changes beyond the names:

  - `@slackwater/engine` drops its deprecated default export and `createTidePredictor.constituents`. Import `createTidePredictor` and `constituents` by name. `ExtremesInput` no longer accepts `timeFidelity`.
  - `@slackwater/react` renames `NeapsProvider` and `useNeapsConfig` to `SlackwaterProvider` and `useSlackwaterConfig`, and its CSS variables from `--neaps-*` to `--slackwater-*`.

## 0.2.0

### Minor Changes

- [#301](https://github.com/openwatersio/neaps/pull/301) [`36a0b23`](https://github.com/openwatersio/neaps/commit/36a0b23a3f9b69fa52efc59cc62b877b0f90c7db) Thanks [@bkeepers](https://github.com/bkeepers)! - Drop the CommonJS builds; all neaps packages are now ESM-only. The CJS entries
  can't survive their dependencies going ESM-only, since they load them with
  `require()`. CommonJS consumers on Node 20.19+ / 22.12+ can still `require()`
  these packages via Node's `require(esm)` support.

## 0.1.1

### Patch Changes

- [#286](https://github.com/openwatersio/neaps/pull/286) [`949d7c3`](https://github.com/openwatersio/neaps/commit/949d7c39f1b78dc84c8c049f030359ea2df5d0f4) Thanks [@bkeepers](https://github.com/bkeepers)! - `<TideStation>` no longer collapses into the tabbed layout based on width alone. Narrow content-sized containers (like phones in portrait) now keep the stacked continuous-scroll view; tabs only appear when an ancestor constrains the height below 500px and the stacked content overflows (e.g. a fixed-size dashboard widget). The tab bar collapses into a dropdown based on height (below 260px) instead of width.

## 0.1.0

### Minor Changes

- [#249](https://github.com/openwatersio/neaps/pull/249) [`4eed5db`](https://github.com/openwatersio/neaps/commit/4eed5dbde3e130d517224b9ede11f2475eb0ada3) Thanks [@bkeepers](https://github.com/bkeepers)! - Initial release of `@neaps/react` — React components and hooks for tide predictions powered by `@neaps/api`, including `<TideStation>`, `<TideGraph>`, `<TideTable>`, `<TideConditions>`, `<StationSearch>`, `<NearbyStations>`, and `<StationsMap>`.
