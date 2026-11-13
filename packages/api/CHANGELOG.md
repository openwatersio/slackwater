# @neaps/api

## 1.0.0-beta.7

### Major Changes

- [`ebc6e6a`](https://github.com/openwatersio/slackwater/commit/ebc6e6a74fadf8d024680e28485a0acaadbc49ce) Thanks [@clarkbw](https://github.com/clarkbw)! - Distinguish minimum flood and ebb currents from maximum flow when the current weakens without reversing. Keep these lulls on the chart and in the schedule, and skip them when showing the next maximum.

  Breaking change for every consumer of current events: event kinds include `minFlood` and `minEbb`, and current reading states include `Minimum flood` and `Minimum ebb`. The HTTP API, the CLI JSON output, the engine, and the Swift and Kotlin packages all return the new kinds unconditionally; update exhaustive event and state handling. Swift and Kotlin `maxima()` return only true maxima; use `events()` to retain minimum curve knots. Deploy the API before the React client so lulls are not shown as maxima.

### Patch Changes

- Updated dependencies [[`ebc6e6a`](https://github.com/openwatersio/slackwater/commit/ebc6e6a74fadf8d024680e28485a0acaadbc49ce)]:
  - slackwater@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- [#508](https://github.com/openwatersio/slackwater/pull/508) [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474) Thanks [@clarkbw](https://github.com/clarkbw)! - Predict magnitude and rotating direction for NOAA harmonic current stations using their published minor-axis data. Station lookups, API timelines, and CLI JSON include the vector predictions automatically. Signed speeds and flood, ebb, and slack events retain their major-axis meaning.

  CLI text identifies slack-window thresholds as major-axis speed. The current-station API schema documents both axes.

- [#508](https://github.com/openwatersio/slackwater/pull/508) [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474) Thanks [@clarkbw](https://github.com/clarkbw)! - Resolve superseded tide-station IDs to accepted replacement models while preserving commercial-use permission. Saved IDs whose replacement would remove commercial-use permission are refused. Direct lookups of noncommercial records remain available; replacements carry their own license and attribution terms.

  Nearby lists and map focus use the resolved station's canonical ID.

- Updated dependencies [[`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474), [`aca73fb`](https://github.com/openwatersio/slackwater/commit/aca73fbb15d1bd43f6234019963a550879685e1c), [`53201e7`](https://github.com/openwatersio/slackwater/commit/53201e73146c558a4b2a1d028bb190bd1e3b2474)]:
  - slackwater@1.0.0-beta.6

## 1.0.0-beta.5

### Minor Changes

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`0817d20`](https://github.com/openwatersio/slackwater/commit/0817d208516b191ff3a48c5c92d4b52e898a45c2) Thanks [@bkeepers](https://github.com/bkeepers)! - Tide and current station listings include each station's `attribution` and `license` in every mode (search, bounding box, proximity, and the full list), so a list can show the credit its stations owe without fetching each one. `license.commercial_use` is `false` for the TICON stations under CC BY-NC 4.0.

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`7ec45ff`](https://github.com/openwatersio/slackwater/commit/7ec45ffb23cf50d1bff288f8e849578cff10eeff) Thanks [@bkeepers](https://github.com/bkeepers)! - Tide station listings and lookups say whether the API can predict each station, with `predictions` and, when it can't, an `unavailable` reason, as the current routes do. Tide listings exclude stations without a prediction model. Direct lookups of Canadian Hydrographic Service ports carry `predictions: false`, and `/tides/stations/:id` serves their unprefixed records, such as `chs-campbell-river`.

- [#502](https://github.com/openwatersio/slackwater/pull/502) [`e53b05f`](https://github.com/openwatersio/slackwater/commit/e53b05f92ada8348c9ada05887e7d3f7fbb90acb) Thanks [@clarkbw](https://github.com/clarkbw)! - Include magnitude and direction in current timelines. Supply minor-axis constituents, mean flow, and azimuth to predict rotary currents; stations with one axis use absolute speed and their published flood or ebb direction. Flood, ebb, and slack events continue to use signed major-axis speed.

### Patch Changes

- Updated dependencies [[`e53b05f`](https://github.com/openwatersio/slackwater/commit/e53b05f92ada8348c9ada05887e7d3f7fbb90acb)]:
  - slackwater@1.0.0-beta.5

## 1.0.0-beta.4

### Major Changes

- [#487](https://github.com/openwatersio/slackwater/pull/487) [`0912bce`](https://github.com/openwatersio/slackwater/commit/0912bcebaa18d328130d58347a17e5e8370fc752) Thanks [@bkeepers](https://github.com/bkeepers)! - Importing `slackwater` or `@slackwater/api` no longer reads the station database, which loads on first use. In `slackwater`, `findStation`, `nearestStation`, `stationsNear`, `findCurrentStation`, `nearestCurrentStation`, `currentStationsNear`, `currentStationUnavailable`, and the `get*Prediction` helpers now return promises, so add `await` to each call. `currentStationUnavailableIn(db, station)` is the synchronous form for filter callbacks, taking a database from `loadStations()`. In `@slackwater/api`, the `openapi` and `currentsOpenapi` exports are now `loadOpenapi()` and `loadCurrentsOpenapi()`, with `Openapi` and `CurrentsOpenapi` types. `createApp`, `createRoutes`, and `createCurrentRoutes` are unchanged. `GET /stations` leaves out tide stations with no model, which it could not route to.

### Patch Changes

- [#488](https://github.com/openwatersio/slackwater/pull/488) [`5b68a75`](https://github.com/openwatersio/slackwater/commit/5b68a759bc88a6dd0e06d95a78a7bc4ebc5f32b5) Thanks [@bkeepers](https://github.com/bkeepers)! - `nearestStation`, `stationsNear`, and the predictions that use them skip tide stations with no model, such as CHS ports, instead of returning a flat zero tide. `findStation` still finds them by id. The `/tides/stations` listing by coordinates no longer includes them.

- [#486](https://github.com/openwatersio/slackwater/pull/486) [`9d89885`](https://github.com/openwatersio/slackwater/commit/9d89885c50b568f8be02699af37e5cec80b2e63a) Thanks [@tstotzer](https://github.com/tstotzer)! - Station listings include stations on both sides of the dateline when a bounding box crosses 180°.
- Updated dependencies [[`0912bce`](https://github.com/openwatersio/slackwater/commit/0912bcebaa18d328130d58347a17e5e8370fc752), [`5b68a75`](https://github.com/openwatersio/slackwater/commit/5b68a759bc88a6dd0e06d95a78a7bc4ebc5f32b5)]:
  - slackwater@1.0.0-beta.4

## 1.0.0-beta.3

### Minor Changes

- [#386](https://github.com/openwatersio/slackwater/pull/386) [`20a2a34`](https://github.com/openwatersio/slackwater/commit/20a2a347a68e34ac5619b3089a948bd00bc07e92) Thanks [@bkeepers](https://github.com/bkeepers)! - Serve tidal current predictions as a sibling route group at `/currents` (set with `createApp({ currentsPrefix })`, or mount `createCurrentRoutes()` yourself): `events` and `timeline` near a location, `stations` search, and per-station `events` and `timeline`, with their own OpenAPI document. `createRoutes()` still returns only the tide routes, at the same paths. Speeds are signed knots along the flood axis, and events are `slack`, `maxFlood`, or `maxEbb` with flood and ebb directions. A station ID with no bin is the primary bin and `@N` selects bin N (`noaa/EPT0003@11`). Listings show each station once with its `bins`. Canadian Hydrographic Service stations are listed but flagged, because CHS terms don't allow its predictions to be redistributed, and their prediction endpoints return 451. The location endpoints refuse the same way when the nearest station is a CHS station, instead of answering for a station farther away. `createApp` throws if `currentsPrefix` equals or contains `prefix`. Prediction spans are limited to 366 days.

  Station search by `query` now honors `maxResults` above 20, and a repeated `query` parameter returns 400, on both `/stations` and `/currents/stations`. `/extremes` and `/timeline` skip tide stations with no harmonic constituents or offsets (the CHS ports), which returned no extremes and a flat zero timeline.

### Patch Changes

- [#383](https://github.com/openwatersio/slackwater/pull/383) [`63efbad`](https://github.com/openwatersio/slackwater/commit/63efbad5cadf10cc1b9db69e500379725936013f) Thanks [@bkeepers](https://github.com/bkeepers)! - Package descriptions, keywords, and homepages present each package as part of the Slackwater family, with the docs at https://openwaters.io/tides/slackwater/. `slackwater` ships a README on npm.

- Updated dependencies [[`d5f2c5e`](https://github.com/openwatersio/slackwater/commit/d5f2c5ea5306348923e8a027210f1ddb82453c38), [`63efbad`](https://github.com/openwatersio/slackwater/commit/63efbad5cadf10cc1b9db69e500379725936013f)]:
  - slackwater@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#371](https://github.com/openwatersio/slackwater/pull/371) [`072a6d1`](https://github.com/openwatersio/slackwater/commit/072a6d19149f840ec0b12e325d4be8f215189d2e) Thanks [@clarkbw](https://github.com/clarkbw)! - Reject out-of-range bounding box coordinates and inverted latitude bounds with HTTP 400. Clarify the GeoJSON longitude-first coordinate order in errors and the OpenAPI specification.

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

## 0.7.0

### Minor Changes

- [#293](https://github.com/openwatersio/neaps/pull/293) [`4c57263`](https://github.com/openwatersio/neaps/commit/4c5726334a5a564f80c92d89292cf236eeae3dd5) Thanks [@bkeepers](https://github.com/bkeepers)! - Make the API runnable on edge runtimes (e.g. Cloudflare Workers).

  - Replace the runtime `express-openapi-validator` with lightweight request
    validation/coercion in `validate.ts`. The validator relies on Ajv codegen
    (`new Function`), which edge runtimes disallow. It's now a dev dependency
    mounted in the test suite, so requests and responses are still validated
    against the OpenAPI spec — keeping the runtime validators in alignment with it.
  - Add a `compress` option to `createApp` (default `true`). The `compression()`
    middleware corrupts responses through the `node:http` bridge on Workers, which
    compress at the edge anyway — pass `createApp({ compress: false })` there.
  - Declare `@neaps/tide-database` as a direct dependency so it's externalized
    from the build instead of bundled. Shrinks the published `dist` from ~30 MB to
    ~20 KB and avoids the station database being bundled twice by downstream
    bundlers.

### Patch Changes

- [#292](https://github.com/openwatersio/neaps/pull/292) [`de44633`](https://github.com/openwatersio/neaps/commit/de44633e5d20c11c462bee154aa91ebb0730688b) Thanks [@bkeepers](https://github.com/bkeepers)! - Add `s-maxage` to the `Cache-Control` header so CDNs and edge caches (e.g. Vercel, Cloudflare) cache responses, not just browsers. Uses the same TTL as `max-age` (`NEAPS_API_MAX_AGE`, default 3600).

- Updated dependencies [[`36a0b23`](https://github.com/openwatersio/neaps/commit/36a0b23a3f9b69fa52efc59cc62b877b0f90c7db), [`4bf8c60`](https://github.com/openwatersio/neaps/commit/4bf8c60df48fe24433833f1cf7a105e9f63e4b0e)]:
  - neaps@0.8.0

## 0.6.0

### Minor Changes

- [#285](https://github.com/openwatersio/neaps/pull/285) [`886392d`](https://github.com/openwatersio/neaps/commit/886392d790744b967710e9693aeca77e9371ebc6) Thanks [@bkeepers](https://github.com/bkeepers)! - Update `express` to v5.

## 0.5.1

### Patch Changes

- Updated dependencies [[`cd1341b`](https://github.com/openwatersio/neaps/commit/cd1341bc44e63398273dab4d2960c1437a15e518)]:
  - neaps@0.7.0

## 0.5.0

### Minor Changes

- [`1af0c22`](https://github.com/openwatersio/neaps/commit/1af0c22bb2181915d879821c17ed909731d2f1d2) Thanks [@bkeepers](https://github.com/bkeepers)! - Add `bbox` query parameter to `GET /stations` for filtering stations by bounding box. Pass a comma-separated string `minLon,minLat,maxLon,maxLat` to return only stations within that geographic area.

  Also allows reserved characters (e.g. commas) in the `query` parameter, enabling searches like `"San Francisco, CA"`.

  Bump `@neaps/tide-database` dependency to `0.7`.

### Patch Changes

- Updated dependencies [[`1af0c22`](https://github.com/openwatersio/neaps/commit/1af0c22bb2181915d879821c17ed909731d2f1d2)]:
  - neaps@0.6.1

## 0.4.0

### Minor Changes

- [#229](https://github.com/openwatersio/neaps/pull/229) [`42f9e92`](https://github.com/openwatersio/neaps/commit/42f9e92222aa09d5c5e0621e77690a931409f8b4) Thanks [@bkeepers](https://github.com/bkeepers)! - Add configurable route prefix support to `createApp()`.

  Routes are now defined without a prefix (e.g. `/extremes`, `/stations`) and mounted at a configurable `prefix` option (defaults to `/tides` for backward compatibility). Also adds a root `/` endpoint returning API info, and the OpenAPI spec now includes a `servers` field reflecting the configured prefix.

- [#227](https://github.com/openwatersio/neaps/pull/227) [`b3efa7c`](https://github.com/openwatersio/neaps/commit/b3efa7cf2460f5f21e490b42f81782878f65d7ed) Thanks [@bkeepers](https://github.com/bkeepers)! - Add support for subordinate station predictions in the API.

  `GET /tides/timeline` and `GET /tides/waterlevel` now return predictions for subordinate stations instead of a 400 error.

### Patch Changes

- Updated dependencies [[`b3efa7c`](https://github.com/openwatersio/neaps/commit/b3efa7cf2460f5f21e490b42f81782878f65d7ed)]:
  - neaps@0.6.0

## 0.3.3

### Patch Changes

- [#215](https://github.com/openwatersio/neaps/pull/215) [`df11392`](https://github.com/openwatersio/neaps/commit/df11392748559d477f0dc70ca910147fcc3414f3) Thanks [@bkeepers](https://github.com/bkeepers)! - Default to station's chart datum (usually LAT or MLLW)

- Updated dependencies [[`df11392`](https://github.com/openwatersio/neaps/commit/df11392748559d477f0dc70ca910147fcc3414f3)]:
  - neaps@0.5.1

## 0.3.2

### Patch Changes

- Updated dependencies [[`9f3fdf6`](https://github.com/openwatersio/neaps/commit/9f3fdf6785492a97dae717a6257c5358fc661e07)]:
  - neaps@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`355f696`](https://github.com/openwatersio/neaps/commit/355f6960af6fc6cd9a5c3d592b5303bb0e4485e9)]:
  - neaps@0.4.0

## 0.3.0

### Minor Changes

- [#199](https://github.com/openwatersio/neaps/pull/199) [`8f2aee6`](https://github.com/openwatersio/neaps/commit/8f2aee600947e7b7c09466d310d03c5b9491b516) Thanks [@bkeepers](https://github.com/bkeepers)! - /tides/stations without coordinates will now return all stations

- [`29a4cb0`](https://github.com/openwatersio/neaps/commit/29a4cb01fd31aefe7d42f1b0f24fea9bc6d6d0d4) Thanks [@bkeepers](https://github.com/bkeepers)! - Added `query` parameter to /tides/stations endpoint to search stations

- [#199](https://github.com/openwatersio/neaps/pull/199) [`8f2aee6`](https://github.com/openwatersio/neaps/commit/8f2aee600947e7b7c09466d310d03c5b9491b516) Thanks [@bkeepers](https://github.com/bkeepers)! - Added caching, compression, and CORS

### Patch Changes

- Updated dependencies [[`c885cce`](https://github.com/openwatersio/neaps/commit/c885cceb9f1632bc2bdb087fccde3f43928c2c5e)]:
  - neaps@0.3.1
