# @neaps/cli

## 1.0.0-beta.4

### Minor Changes

- [#391](https://github.com/openwatersio/slackwater/pull/391) [`2b1711b`](https://github.com/openwatersio/slackwater/commit/2b1711b0afef7255d2792317fdaf778a071fe50c) Thanks [@bkeepers](https://github.com/bkeepers)! - Add tidal currents with `slackwater currents`. `currents` (or `currents events`) shows slack water, max flood, and max ebb with speed in knots and direction in degrees true; `currents timeline` shows speed over time; `currents slack --threshold <knots>` shows the windows around each turn when the current runs below that speed; and `currents stations` searches current stations by name or location. Pick a station with `--station`, `--near`, or `--ip`. A bare station ID is the primary depth bin and `@N` selects bin N (`noaa/EPT0003@11`); an unknown bin lists the bins that exist. Canadian Hydrographic Service stations, whose terms don't allow redistributing their predictions, and stations with no model fail with the reason. `--format json` for `currents events` and `currents timeline` returns the same shape as the matching `@slackwater/api` endpoints.

  `stations --all` now lists every match with `--near` or a query, instead of stopping at 10 or 20, and `stations <query> --near` ranks every station matching the query by distance instead of only the top 20 text matches. `--limit` must be a positive whole number.

## 1.0.0-beta.3

### Patch Changes

- [#383](https://github.com/openwatersio/slackwater/pull/383) [`63efbad`](https://github.com/openwatersio/slackwater/commit/63efbad5cadf10cc1b9db69e500379725936013f) Thanks [@bkeepers](https://github.com/bkeepers)! - Package descriptions, keywords, and homepages present each package as part of the Slackwater family, with the docs at https://openwaters.io/tides/slackwater/. `slackwater` ships a README on npm.

- Updated dependencies [[`20a2a34`](https://github.com/openwatersio/slackwater/commit/20a2a347a68e34ac5619b3089a948bd00bc07e92), [`d5f2c5e`](https://github.com/openwatersio/slackwater/commit/d5f2c5ea5306348923e8a027210f1ddb82453c38), [`63efbad`](https://github.com/openwatersio/slackwater/commit/63efbad5cadf10cc1b9db69e500379725936013f)]:
  - @slackwater/api@1.0.0-beta.3
  - slackwater@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#384](https://github.com/openwatersio/slackwater/pull/384) [`683a3e6`](https://github.com/openwatersio/slackwater/commit/683a3e6d61eb4e792bc1eeca5c989ddf90a59814) Thanks [@bkeepers](https://github.com/bkeepers)! - The standalone `slackwater` binaries start up again. They crashed on launch with `TypeError: Invalid URL` because the station database could not be found inside the binary.

## 1.0.0-beta.1

### Major Changes

- [#339](https://github.com/openwatersio/slackwater/pull/339) [`8fc2e6f`](https://github.com/openwatersio/slackwater/commit/8fc2e6f585ccdb6bea9117230d8fed7c69b158d2) Thanks [@bkeepers](https://github.com/bkeepers)! - Neaps is now Slackwater. `neaps` is `slackwater`, `@neaps/tide-predictor` is `@slackwater/engine`, and the CLI, API, and React packages move to the `@slackwater` scope. The CLI command is `slackwater`, and `install.sh` reads `SLACKWATER_VERSION` and `SLACKWATER_INSTALL_DIR`. The Swift library product is `SlackwaterKit`. Station data comes from `@slackwater/database`, which replaces `@neaps/tide-database`.

  Breaking changes beyond the names:

  - `@slackwater/engine` drops its deprecated default export and `createTidePredictor.constituents`. Import `createTidePredictor` and `constituents` by name. `ExtremesInput` no longer accepts `timeFidelity`.
  - `@slackwater/react` renames `NeapsProvider` and `useNeapsConfig` to `SlackwaterProvider` and `useSlackwaterConfig`, and its CSS variables from `--neaps-*` to `--slackwater-*`.

### Minor Changes

- [#340](https://github.com/openwatersio/slackwater/pull/340) [`5b40865`](https://github.com/openwatersio/slackwater/commit/5b40865277dd6a5696250c6953d1579a9820a035) Thanks [@bkeepers](https://github.com/bkeepers)! - Upgrade to @neaps/tide-database 0.10, which adds current stations to the database. Station lookups and predictions filter to tide stations, and `Station.disclaimers` is now optional.

### Patch Changes

- Updated dependencies [[`8fc2e6f`](https://github.com/openwatersio/slackwater/commit/8fc2e6f585ccdb6bea9117230d8fed7c69b158d2), [`5b40865`](https://github.com/openwatersio/slackwater/commit/5b40865277dd6a5696250c6953d1579a9820a035)]:
  - slackwater@1.0.0-beta.1
  - @slackwater/api@1.0.0-beta.1

## 0.2.0

### Minor Changes

- [#303](https://github.com/openwatersio/neaps/pull/303) [`4bf8c60`](https://github.com/openwatersio/neaps/commit/4bf8c60df48fe24433833f1cf7a105e9f63e4b0e) Thanks [@bkeepers](https://github.com/bkeepers)! - Update @neaps/tide-database to 0.9. Station prediction data now lives in an
  off-heap pack file read per station instead of being parsed into the JS heap
  at import, dropping baseline heap usage from ~118 MB to ~36 MB.

### Patch Changes

- Updated dependencies [[`4c57263`](https://github.com/openwatersio/neaps/commit/4c5726334a5a564f80c92d89292cf236eeae3dd5), [`de44633`](https://github.com/openwatersio/neaps/commit/de44633e5d20c11c462bee154aa91ebb0730688b), [`36a0b23`](https://github.com/openwatersio/neaps/commit/36a0b23a3f9b69fa52efc59cc62b877b0f90c7db), [`4bf8c60`](https://github.com/openwatersio/neaps/commit/4bf8c60df48fe24433833f1cf7a105e9f63e4b0e)]:
  - @neaps/api@0.7.0
  - neaps@0.8.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`886392d`](https://github.com/openwatersio/neaps/commit/886392d790744b967710e9693aeca77e9371ebc6)]:
  - @neaps/api@0.6.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`cd1341b`](https://github.com/openwatersio/neaps/commit/cd1341bc44e63398273dab4d2960c1437a15e518)]:
  - neaps@0.7.0
  - @neaps/api@0.5.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`1af0c22`](https://github.com/openwatersio/neaps/commit/1af0c22bb2181915d879821c17ed909731d2f1d2)]:
  - @neaps/api@0.5.0
  - neaps@0.6.1

## 0.1.0

### Minor Changes

- [#218](https://github.com/openwatersio/neaps/pull/218) [`fe7ddbf`](https://github.com/openwatersio/neaps/commit/fe7ddbf85c2086fbfb0537a297ba840a50e29d9a) Thanks [@bkeepers](https://github.com/bkeepers)! - Created initial `neaps` CLI
