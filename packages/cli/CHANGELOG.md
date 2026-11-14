# @neaps/cli

## 1.0.0-beta.8

### Major Changes

- [`ebc6e6a`](https://github.com/openwatersio/slackwater/commit/ebc6e6a74fadf8d024680e28485a0acaadbc49ce) Thanks [@clarkbw](https://github.com/clarkbw)! - Distinguish minimum flood and ebb currents from maximum flow when the current weakens without reversing. Keep these lulls on the chart and in the schedule, and skip them when showing the next maximum.

  Breaking change for every consumer of current events: event kinds include `minFlood` and `minEbb`, and current reading states include `Minimum flood` and `Minimum ebb`. The HTTP API, the CLI JSON output, the engine, and the Swift and Kotlin packages all return the new kinds unconditionally; update exhaustive event and state handling. Swift and Kotlin `maxima()` return only true maxima; use `events()` to retain minimum curve knots. Deploy the API before the React client so lulls are not shown as maxima.

### Patch Changes

- [#515](https://github.com/openwatersio/slackwater/pull/515) [`0c5a9cf`](https://github.com/openwatersio/slackwater/commit/0c5a9cf134879a6eedb588601428b669b40f9fdc) Thanks [@tstotzer](https://github.com/tstotzer)! - Report when a tide station has no local prediction model instead of directing `currents` users to tide commands that cannot predict it.
- Updated dependencies [[`ebc6e6a`](https://github.com/openwatersio/slackwater/commit/ebc6e6a74fadf8d024680e28485a0acaadbc49ce)]:
  - slackwater@1.0.0-beta.7
  - @slackwater/api@1.0.0-beta.7

## 1.0.0-beta.7

### Patch Changes

- [#508](https://github.com/openwatersio/slackwater/pull/508) [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474) Thanks [@clarkbw](https://github.com/clarkbw)! - Print the station's source credits alongside text predictions and listings.

- [#508](https://github.com/openwatersio/slackwater/pull/508) [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474) Thanks [@clarkbw](https://github.com/clarkbw)! - Predict magnitude and rotating direction for NOAA harmonic current stations using their published minor-axis data. Station lookups, API timelines, and CLI JSON include the vector predictions automatically. Signed speeds and flood, ebb, and slack events retain their major-axis meaning.

  CLI text identifies slack-window thresholds as major-axis speed. The current-station API schema documents both axes.

- [#508](https://github.com/openwatersio/slackwater/pull/508) [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474) Thanks [@clarkbw](https://github.com/clarkbw)! - Resolve superseded tide-station IDs to accepted replacement models while preserving commercial-use permission. Saved IDs whose replacement would remove commercial-use permission are refused. Direct lookups of noncommercial records remain available; replacements carry their own license and attribution terms.

  Nearby lists and map focus use the resolved station's canonical ID.

- Updated dependencies [[`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474), [`aca73fb`](https://github.com/openwatersio/slackwater/commit/aca73fbb15d1bd43f6234019963a550879685e1c), [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474)]:
  - slackwater@1.0.0-beta.6
  - @slackwater/api@1.0.0-beta.6

## 1.0.0-beta.6

### Minor Changes

- [#502](https://github.com/openwatersio/slackwater/pull/502) [`e53b05f`](https://github.com/openwatersio/slackwater/commit/e53b05f92ada8348c9ada05887e7d3f7fbb90acb) Thanks [@clarkbw](https://github.com/clarkbw)! - Include magnitude and direction in current timelines. Supply minor-axis constituents, mean flow, and azimuth to predict rotary currents; stations with one axis use absolute speed and their published flood or ebb direction. Flood, ebb, and slack events continue to use signed major-axis speed.

### Patch Changes

- Updated dependencies [[`0817d20`](https://github.com/openwatersio/slackwater/commit/0817d208516b191ff3a48c5c92d4b52e898a45c2), [`7ec45ff`](https://github.com/openwatersio/slackwater/commit/7ec45ffb23cf50d1bff288f8e849578cff10eeff), [`e53b05f`](https://github.com/openwatersio/slackwater/commit/e53b05f92ada8348c9ada05887e7d3f7fbb90acb)]:
  - @slackwater/api@1.0.0-beta.5
  - slackwater@1.0.0-beta.5

## 1.0.0-beta.5

### Patch Changes

- [#485](https://github.com/openwatersio/slackwater/pull/485) [`47df5af`](https://github.com/openwatersio/slackwater/commit/47df5af9f8b03a3813e72998a887ec4dbece0b29) Thanks [@bkeepers](https://github.com/bkeepers)! - Homebrew now installs the CLI on Homebrew's Node, so it works on Intel Macs and ARM Linux and no longer needs `libatomic` from the system. The shell installer checks that the downloaded binary runs and, if a system library is missing, stops with the command to install it.
- Updated dependencies [[`0912bce`](https://github.com/openwatersio/slackwater/commit/0912bcebaa18d328130d58347a17e5e8370fc752), [`5b68a75`](https://github.com/openwatersio/slackwater/commit/5b68a759bc88a6dd0e06d95a78a7bc4ebc5f32b5), [`9d89885`](https://github.com/openwatersio/slackwater/commit/9d89885c50b568f8be02699af37e5cec80b2e63a)]:
  - slackwater@1.0.0-beta.4
  - @slackwater/api@1.0.0-beta.4

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
