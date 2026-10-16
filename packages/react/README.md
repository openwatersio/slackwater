# @slackwater/react

React components for tide and current predictions powered by [Slackwater](https://openwaters.io/tides/slackwater/). They follow the design of the Slackwater app: a dark theme, a timeline you scrub under a fixed reading line, and a week's schedule beneath it.

## Installation

```sh
npm install @slackwater/react
```

Peer dependencies:

```sh
npm install react react-dom
# Optional — needed for <StationsMap>
npm install maplibre-gl react-map-gl
```

The components are styled with [Tailwind CSS v4](https://tailwindcss.com), which your app must also use. See [Styling](#styling).

## Quick Start

Wrap your app with `<SlackwaterProvider>` and point it at a running [`@slackwater/api`](../api) instance:

```tsx
import { SlackwaterProvider, TideStation } from "@slackwater/react";

function App() {
  return (
    <SlackwaterProvider baseUrl="https://api.example.com">
      <TideStation id="noaa/9447130" />
    </SlackwaterProvider>
  );
}
```

```css
/* app.css */
@import "tailwindcss";
@import "@slackwater/react/styles.css";
@source "../node_modules/@slackwater/react/dist";
```

## Provider

`<SlackwaterProvider>` configures the API and the reader's preferences for every component inside it.

```tsx
<SlackwaterProvider baseUrl="https://api.example.com" units="feet">
  {children}
</SlackwaterProvider>
```

| Prop          | Type                 | Default                            | Description                                                                     |
| ------------- | -------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `baseUrl`     | `string`             | —                                  | API server URL; may include a path prefix                                       |
| `units`       | `"meters" \| "feet"` | feet for `en-US`, otherwise meters | Height units                                                                    |
| `datum`       | `string`             | the station's chart datum          | Vertical datum for the hooks and `<TideConditions>`; `<TideStation>` ignores it |
| `timezone`    | `string`             | the station's time zone            | Time zone for `<TideConditions>`                                                |
| `locale`      | `string`             | `navigator.language`               | BCP 47 locale for clocks, dates, and numbers                                    |
| `queryClient` | `QueryClient`        | created for you                    | A TanStack Query client, for example one hydrated on the server                 |

## Components

### `<TideStation>`

A tide station's page, after the app's tide detail screen:

- the name and region over a `<TideScrubber>`, with the reading for the selected moment and pills for the next event and the way back to now;
- a schedule card with the week's highs and lows, a day at a time with sunrise, solar noon, and sunset. The row nearest the selection is highlighted, and choosing a row moves the scrubber there. The week bar opens a date picker;
- where the predictions come from, the station's disclaimers and attribution, and a "Station details" disclosure with its datum, ID, position, time zone, and reference station.

Heights are always above the station's chart datum, which the page names. The page loads a window from 96 hours before to 180 hours after the start of the week in the station's time zone, and moves it when a date is picked, when Now is chosen, or when the page is shown again two or more days later.

```tsx
<TideStation id="noaa/9447130" />
```

| Prop        | Type     | Default | Description                         |
| ----------- | -------- | ------- | ----------------------------------- |
| `id`        | `string` | —       | Station ID (e.g. `"noaa/9447130"`)  |
| `className` | `string` | —       | Extra classes for the outer element |

### `<CurrentStation>`

A tidal current station's page, with the same layout as `<TideStation>`: a `<CurrentScrubber>`, the week's slacks and maxima with their set, where the predictions come from, and the station's details. Stations whose predictions can't be served, such as CHS stations, show the reason instead. The current components need `@slackwater/api` 1.0.0-beta.3 or later, which serves the `/currents` routes.

```tsx
<CurrentStation id="noaa/PUG1701" />
<CurrentStation id="noaa/EPT0003@11" threshold={1} />
```

| Prop        | Type     | Default | Description                                                        |
| ----------- | -------- | ------- | ------------------------------------------------------------------ |
| `id`        | `string` | —       | Station ID, optionally with a depth bin (e.g. `"noaa/EPT0003@11"`) |
| `threshold` | `number` | `0.5`   | Boat speed in knots that sizes the slack windows                   |
| `className` | `string` | —       | Extra classes for the outer element                                |

### `<TideScrubber>`

A tide timeline that scrolls under a fixed reading line. The lead reads the height and whether the tide is rising, falling, high, or low at the selected moment. The water is shaded amber where it drops below chart datum, and the curve turns from blue through yellow to red where the tide moves faster than 0.6 m an hour. Each high and low carries its height and time, and the vertical scale follows the water in view. Drag, scroll, tap, or use the arrow keys (Shift moves between events). Used by `<TideStation>`, and available on its own.

```tsx
<TideScrubber
  timeline={timeline}
  extremes={extremes}
  timezone="America/Los_Angeles"
  latitude={47.6}
  longitude={-122.3}
  units="feet"
/>
```

| Prop        | Type              | Default         | Description                                                    |
| ----------- | ----------------- | --------------- | -------------------------------------------------------------- |
| `timeline`  | `TimelineEntry[]` | —               | Heights above chart datum; fewer than two shows a message      |
| `extremes`  | `Extreme[]`       | —               | Highs and lows                                                 |
| `timezone`  | `string`          | —               | Station IANA time zone for clocks, dates, and days             |
| `latitude`  | `number`          | —               | Station latitude, for sunrise and sunset                       |
| `longitude` | `number`          | —               | Station longitude, for sunrise and sunset                      |
| `units`     | `Units`           | —               | The units of `timeline` and `extremes`                         |
| `locale`    | `string`          | reader's locale | BCP 47 locale for clocks and dates                             |
| `now`       | `number`          | the clock       | The current instant in ms; pass it to render deterministically |
| `className` | `string`          | —               | Extra classes for the outer element                            |

### `<CurrentScrubber>`

The current timeline: the speed, set, and state at the selected moment, green slack windows sized by a boat-speed threshold, a curve threaded by speed, and the speed and set at each maximum. Used by `<CurrentStation>`, and available on its own.

```tsx
<CurrentScrubber
  timeline={timeline}
  events={events}
  timezone="America/Los_Angeles"
  latitude={48.1}
  longitude={-122.7}
  directions={{ flood: 160, ebb: 340 }}
/>
```

| Prop         | Type                     | Default         | Description                                                            |
| ------------ | ------------------------ | --------------- | ---------------------------------------------------------------------- |
| `timeline`   | `CurrentTimelineEntry[]` | —               | Signed speeds in knots, flood positive; fewer than two shows a message |
| `events`     | `CurrentEvent[]`         | —               | Slack, max flood, and max ebb events                                   |
| `timezone`   | `string`                 | —               | Station IANA time zone for clocks, dates, and days                     |
| `latitude`   | `number`                 | —               | Station latitude, for sunrise and sunset                               |
| `longitude`  | `number`                 | —               | Station longitude, for sunrise and sunset                              |
| `directions` | `{ flood?, ebb? }`       | `{}`            | Flood and ebb set in degrees true                                      |
| `threshold`  | `number`                 | `0.5`           | Boat speed in knots that sizes the slack windows                       |
| `locale`     | `string`                 | reader's locale | BCP 47 locale for clocks and dates                                     |
| `now`        | `number`                 | the clock       | The current instant in ms; pass it to render deterministically         |
| `className`  | `string`                 | —               | Extra classes for the outer element                                    |

Both scrubbers also take `onSelect(time)`, called as the selected moment changes, `moveTo`, an object whose `time` the strip moves to each time a new object is passed, and `onNow(now)`, called when the reader returns to now.

### `<TideConditions>`

The water level now, whether it is rising or falling, and the next high or low, over a faint tide curve. Pass data, or a station ID to fetch it.

```tsx
<TideConditions id="noaa/9447130" />
<TideConditions timeline={timeline} extremes={extremes} units="meters" timezone="UTC" />
```

### `<StationSearch>`

Autocomplete search input for finding stations.

```tsx
<StationSearch onSelect={(station) => console.log(station)} />
```

### `<NearbyStations>`

List of stations near a given station or coordinates.

```tsx
<NearbyStations stationId="noaa/9447130" maxResults={5} />
<NearbyStations latitude={47.6} longitude={-122.3} />
```

### `<StationsMap>`

Interactive map of the tide stations in view. Requires `maplibre-gl` and `react-map-gl`. Stations are fetched by bounding box as the reader pans and zooms.

```tsx
<StationsMap
  mapStyle="https://tiles.example.com/style.json"
  onStationSelect={(station) => console.log(station)}
/>
```

### `<StationDisclaimers>`

A station's disclaimers as a paragraph, or nothing when it has none.

## Hooks

All hooks must be used within a `<SlackwaterProvider>`.

- `useStation(id)` — fetch a single tide station
- `useStations({ query?, bbox?, latitude?, longitude? })` — search or list stations (a bounding box is `"minLon,minLat,maxLon,maxLat"`)
- `useNearbyStations({ latitude, longitude, maxResults? })` — fetch the stations nearest a position
- `useTimeline({ id, start?, end?, datum?, units? }, options?)` — fetch a tide height timeline
- `useExtremes({ id, start?, end?, datum?, units? }, options?)` — fetch highs and lows
- `useCurrentStation(id)` — fetch a current station
- `useCurrentEvents(id, { start, end })` — fetch slack, max flood, and max ebb events
- `useCurrentTimeline(id, { start, end })` — fetch the signed current speed timeline
- `useCurrentLevel(timeline)` — the water level now, interpolated and updated each minute
- `useThemeColors()` — the map's colors, resolved from the theme variables

`useTimeline` and `useExtremes` also take a location (`{ latitude, longitude }`) in place of an `id`. Their `options` set `enabled`, `staleTime`, and `placeholderData`.

## Server rendering

`prefetchTideStation(queryClient, baseUrl, id, { units?, locale?, now? })` fills a query client with everything `<TideStation>` loads, and `prefetchNearbyStations` does the same for `<NearbyStations>`. Pass `dehydrate(queryClient)` to the client and render inside a `<HydrationBoundary>`; both are re-exported from TanStack Query.

## Styling

The components use Tailwind CSS v4 utility classes and the theme variables in `@slackwater/react/styles.css`. The package does not ship compiled utilities, so your app must run Tailwind v4 and scan the package's build output with `@source`:

```css
/* app.css */
@import "tailwindcss";
@import "@slackwater/react/styles.css";
@source "../node_modules/@slackwater/react/dist";
```

Adjust the `@source` path so it points at `node_modules/@slackwater/react/dist` from your stylesheet.

### Theme Variables

The theme is dark only, after the Slackwater app. Every color is a `--sw-*` variable on `:root`; override any of them to retheme the components:

```css
:root {
  --sw-canvas: #05122a; /* the page */
  --sw-foam: #e4f0e4; /* text; secondary text is foam at an opacity */
  --sw-go: #88b868; /* slack, the selected schedule row */
  --sw-graph-line: #38bdf8; /* the curve */
  --sw-graph-high: #2dd4bf; /* tide highs and rising water */
  --sw-graph-low: #fbbf24; /* tide lows, falling water, below datum */
  --sw-flood: #4a9fd8;
  --sw-ebb: #e8a33d;
}
```

See `styles.css` for the full set, including the speed ramp, sun, card, map, and type variables.

## License

MIT
