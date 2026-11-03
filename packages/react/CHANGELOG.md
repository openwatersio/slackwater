# @neaps/react

## 1.0.0-beta.3

### Major Changes

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`6726d38`](https://github.com/openwatersio/slackwater/commit/6726d38b6401f20b1b353703b016617d59fa9560) Thanks [@bkeepers](https://github.com/bkeepers)! - `StationCard` is the Slackwater app's station card: a station's name and region, the reading now, and a 25-hour curve with each high, low, maximum, and slack window. It loads its own predictions once it scrolls into view. With both `href` and `onSelect`, a plain click calls `onSelect` in place of following the link, and a modified or middle click opens the link.

  `TideConditions` is the app's small home-screen widget: the station's name, the height with an arrow for rising or falling, and a 12-hour curve. It is 170 px tall unless `fill` is set, and takes an optional `name`, `chartDatum`, and `now` with data. Given an `id`, it loads the station first and gives the reason for one the API can't serve, such as `chs-campbell-river`. Its `showDate` prop is removed. `WaterLevelAtTime` is removed.

  `NearbyStations` shows tide and current stations together as station cards, nearest first, with their distance in nautical miles. Its `stationId` takes a `kind` for a current station. `StationSearch` follows the app's search: a "Harbor, bay, or channel" field with a clear button, All / Tides / Currents filters, and matching stations of both kinds as cards in a grid, with "No matches" and a notice when it stops at 60. Recent searches are removed. Both call back with the station's new `kind`.

  `TideStation` and `CurrentStation` end with the nearest stations and take `onStationSelect`. `StationSummary` has a `kind` of `"tide"` or `"current"`. `fetchCurrentStations`, `useCurrentStations`, and the `CurrentStationSummary` type are new, and `prefetchNearbyStations` fills both lists. `prefetchTideStation` also fills the page's Nearby lists.

  Station pages show three nearby stations using the shared search list layout, followed by a framed map. `NearbyStations` accepts `showMap` and a tide/current `filter`; a failed map download leaves the list and page usable.

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`3a06d0d`](https://github.com/openwatersio/slackwater/commit/3a06d0d847c4c66dc40be85e7b4950d377bf4f08) Thanks [@bkeepers](https://github.com/bkeepers)! - `StationsMap` is the Slackwater app's stations map. It shows tide and current stations together as live pins on OpenFreeMap's dark fiord style, north up: a tide is a gauge filled to where the water sits between its turns, teal while rising and amber while falling, and a current is an arrow toward its set, green at slack and otherwise colored by its speed. Readings, gauges, and arrows appear from zoom 9.5 and names from 10.5; below that every pin is a dot. Each 44 px cell keeps one station instead of clustering, and pins update each minute. A tap shows the station's `StationCard` in a bottom panel, and `onStationSelect` fires when that card is tapped rather than when the pin is. The map carries a "Not for navigation." notice, below the card in its unit legend, a locate button that centers on the reader at zoom 10.5, and its attribution top-right.

  `clustering`, `clusterMaxZoom`, `clusterRadius`, and `popupContent` are removed. `mapStyle` defaults to fiord, and `threshold` and `now` are new. `useThemeColors` uses the `--sw-*` palette names, including `go`, `graphHigh`, and `graphLow`; the former `primary`, `secondary`, `high`, `low`, `danger`, `bg`, `bgSubtle`, `text`, `textMuted`, `border`, `mapText`, and `mapBg` fields are removed. `timelineQuery`, `extremesQuery`, `currentTimelineQuery`, and `currentEventsQuery` return the query key and function behind `useTimeline`, `useExtremes`, `useCurrentTimeline`, and `useCurrentEvents`.

  The full map puts Tides ft/m and Currents kn in the bottom legend, with no unit suffixes on pins; framed Nearby maps keep their unit suffixes. `showLegend` controls this presentation, and `onPinSelect` opens an embedded pin directly. Current pins use the same predicted Slack timestamps as station cards. The map packages are required peer dependencies because station detail pages include a map.

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`5b766f4`](https://github.com/openwatersio/slackwater/commit/5b766f4346c549b47dd602bd17110823ee82866c) Thanks [@bkeepers](https://github.com/bkeepers)! - `TideStation` is the Slackwater app's tide detail screen: a `TideScrubber` timeline with the reading for the selected moment, a schedule card with the week's highs and lows, where the predictions come from, and the station's details. Heights are above the station's chart datum, and a station whose `datums` don't include it names no datum and marks nothing at 0. `CurrentStation` shares the layout, with the week's slacks and maxima in its schedule.

  The components are dark only. Their colors are the `--sw-*` variables in `styles.css`, which replace the `--slackwater-*` palette, and they need Tailwind CSS v4 with `@source` pointing at the package. Tailwind v4 is an optional peer dependency.

  `TideScrubber` is new; its `chartDatum={false}` leaves 0 unmarked for heights that aren't above a chart datum. `TideGraph`, `TideGraphChart`, `NightBands`, `YAxisOverlay`, `TideTable`, `TideSettings`, `TideStationHeader`, and `TideCycleGraph` are removed, along with the `useTideChunks`, `useTideScales`, `useContainerSize`, `useHashTab`, and `useDarkMode` hooks, `withAlpha`, and `getDefaultRange`. `TideStation`'s props other than `id` and `className` are removed. A station page given a new `id` starts over on that station's week. `useThemeColors` returns the map's colors from the `--sw-*` variables as `rgb()` or `rgba()`, whatever color syntax an override uses. `useTimeline` and `useExtremes` take query options. `prefetchTideStation` fills the queries the new `TideStation` reads, and its `datum` option is removed.

  As in the app, there is one datum everywhere: `SlackwaterProvider`'s `datum` prop and setting are removed, a `datum` that `TideSettings` saved in the browser is ignored and dropped, and `useTimeline`, `useExtremes`, `timelineQuery`, and `extremesQuery` take no `datum`. Cards, map pins, widgets, and pages all ask for the API's default, the station's chart datum, and share their queries. The `fetch*` client functions still pass a `datum` through. `ExtremesResponse` and `TimelineResponse` have no `datum` for a station whose `datums` don't include its chart datum.

  `StationSummary` carries the listings' `predictions` and `unavailable`. `TideStation`, like `CurrentStation`, gives the reason for a station whose predictions the API can't serve instead of loading them, and `fetchStation` takes the bare ID of a curated record such as `chs-campbell-river`. The station client functions encode the ID and throw "Invalid station ID" for one that isn't `source/id` or a single bare segment. `fetchStationExtremes` and `fetchStationTimeline` take only `source/id`, as the API serves tide predictions. Use the API beta from the same release as the React components: it includes listing credits, tide availability flags, and bare CHS identity lookups that the published API 1.0.0-beta.4 lacks.

  The tide lead includes fast rise/fall rates, and the next-event pill always moves forward through water and sun events. High and low axis times reuse their event colors, including on station cards. The return to Now uses a chevron.

### Minor Changes

- [#404](https://github.com/openwatersio/slackwater/pull/404) [`a805c42`](https://github.com/openwatersio/slackwater/commit/a805c42178e05e90f60fa4dfa8a0e7d2a42df916) Thanks [@bkeepers](https://github.com/bkeepers)! - Add `CurrentStation` and `CurrentScrubber` for tidal current stations: a timeline that scrolls under a fixed reading line, after the Slackwater app. It shows the speed, set, and state at the selected moment, blue comfort windows sized by a boat-speed threshold and short green strokes at predicted zeros, a curve colored by speed, the speed and set at each maximum, sunrise and sunset, and pills that name the next event and return to now. New client functions and hooks fetch current stations, events, and timelines from the API.

  Slack readings use predicted event timestamps, independently of the comfort threshold. Window edges follow the signed curve, overlapping windows merge, and continuous windows retain exact Slack times in green. Maximum flood and ebb times have a separate gray row. The pill walks forward through window opening, Slack, closing, maxima and sun events; the return to Now uses a chevron.

- [#501](https://github.com/openwatersio/slackwater/pull/501) [`5ef0a71`](https://github.com/openwatersio/slackwater/commit/5ef0a71c53a1e810f37fc63a8f271ec277689543) Thanks [@clarkbw](https://github.com/clarkbw)! - Use local or precomputed tide and current predictions through the provider's `dataSource` prop. Hooks, maps, and server prefetch share the source and isolate cached results by dataset and access policy. HTTP consumers can keep using `baseUrl`; applications that seed query caches manually must pass the source's `cacheKey` to the query-key builders. Server rendering with different internal and public API URLs needs adapters with an explicit shared cache identity.

  `useSlackwaterConfig()` exposes the active `dataSource`; `baseUrl` is optional when a source is injected. Code that constructs `SlackwaterConfig` values must supply a source, and code reading `baseUrl` must account for its absence.

  Changing source identity, including changing `baseUrl`, remounts provider children to clear old selections and prediction placeholders. Older hydrated or persisted caches use unscoped keys and refetch; deploy matching server and client versions for server rendering. `SlackwaterProviderProps` is a union type, so custom props should compose it with a type intersection rather than an interface extension.

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`0817d20`](https://github.com/openwatersio/slackwater/commit/0817d208516b191ff3a48c5c92d4b52e898a45c2) Thanks [@bkeepers](https://github.com/bkeepers)! - Show each station's credit wherever its predictions appear. `<NearbyStations>` and `<StationSearch>` print the distinct credits of the stations they show once under the cards, `<TideConditions>` prints its station's credit under the widget (pass `attribution` with the data props), and `<StationsMap>` adds the credits of the stations predicted in view to its attribution control and prints the open card's credit under it. `<StationCredits>` does the same for cards you lay out yourself. `StationSummary` carries `attribution` and `license`, with the new `StationLicense` type.

- [#406](https://github.com/openwatersio/slackwater/pull/406) [`2514e39`](https://github.com/openwatersio/slackwater/commit/2514e3992604fbf9b4a16c4f8b231d8319d9e5da) Thanks [@bkeepers](https://github.com/bkeepers)! - `TideStation` and `CurrentStation` show the Slackwater app's summary tiles between the timeline and the schedule, following the selected moment. A tide station's **Range** tile gives the height from the turn behind to the turn ahead, "low to high" or "high to low", and says "beyond normal here" or "the fortnight's biggest" when the swing stands out against the fifteen days either side. A current station's **Next max** tile gives the next maximum's speed and time, "Flood at 10:42 PM", with "Strong" or "Hardest" for a maximum that stands out against its own direction's. Both pages add a **Moon** tile with the phase, its glyph, and the tide it drives: spring or neap, perigean or apogean, or how much is lit. Both pages fetch the fifteen days either side of the day they opened for ranking; tide pages also fetch the complete outlook week. `prefetchTideStation` fills both.

  The water tile spans the width above paired Moon and Sun tiles; all three share a row in wide panes. Sun names the next rise/set and daylight duration. Range shows seven daily swing bars and fetches a complete week when the outlook shifts.

### Patch Changes

- [#502](https://github.com/openwatersio/slackwater/pull/502) [`e53b05f`](https://github.com/openwatersio/slackwater/commit/e53b05f92ada8348c9ada05887e7d3f7fbb90acb) Thanks [@clarkbw](https://github.com/clarkbw)! - Include magnitude and direction in current timelines. Supply minor-axis constituents, mean flow, and azimuth to predict rotary currents; stations with one axis use absolute speed and their published flood or ebb direction. Flood, ebb, and slack events continue to use signed major-axis speed.

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
