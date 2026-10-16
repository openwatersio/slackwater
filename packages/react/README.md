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

`<SlackwaterProvider>` configures the API and the reader's preferences for every component inside it. There is no datum setting: as in the app, tide heights are above the station's chart datum wherever it has one.

```tsx
<SlackwaterProvider baseUrl="https://api.example.com" units="feet">
  {children}
</SlackwaterProvider>
```

| Prop          | Type                 | Default                            | Description                                                     |
| ------------- | -------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `baseUrl`     | `string`             | —                                  | API server URL; may include a path prefix                       |
| `units`       | `"meters" \| "feet"` | feet for `en-US`, otherwise meters | Height units                                                    |
| `timezone`    | `string`             | the station's time zone            | Time zone for `<TideConditions>`                                |
| `locale`      | `string`             | `navigator.language`               | BCP 47 locale for clocks, dates, and numbers                    |
| `queryClient` | `QueryClient`        | created for you                    | A TanStack Query client, for example one hydrated on the server |

## Components

### `<TideStation>`

A tide station's page, after the app's tide detail screen:

- the name and region over a `<TideScrubber>`, with the reading for the selected moment and pills for the next event and the way back to now;
- two tiles that follow the selected moment. **Range** is the height between the turn behind it and the turn ahead, captioned "low to high" or "high to low". When that swing is in the top tenth of every swing in the fifteen days either side of the day the page opened, the caption says "beyond normal here", or "the fortnight's biggest" when no swing in that window is bigger. **Moon** names the phase and the tide the Moon is driving: spring or neap, perigean or apogean within two days of perigee or apogee, or how much of it is lit;
- a schedule card with the week's highs and lows, a day at a time with sunrise, solar noon, and sunset. The row nearest the selection is highlighted, and choosing a row moves the scrubber there. The week bar opens a date picker;
- where the predictions come from, the station's disclaimers and attribution, and a "Station details" disclosure with its datum, ID, position, time zone, and reference station;
- the six nearest tide and current stations, as `<NearbyStations>` cards.

Heights are above the station's chart datum, which the page names. A station whose `datums` don't include its chart datum, such as `noaa/8519024`, reads about mean sea level, so the page names no datum and marks nothing at 0. The page loads a window from 96 hours before to 180 hours after the start of the week in the station's time zone, and moves it when a date is picked, when Now is chosen, or when the page is shown again two or more days later. Stations whose predictions can't be served, such as the CHS ports, show the reason instead.

```tsx
<TideStation id="noaa/9447130" />
```

| Prop              | Type                | Default | Description                                    |
| ----------------- | ------------------- | ------- | ---------------------------------------------- |
| `id`              | `string`            | —       | Station ID (e.g. `"noaa/9447130"`)             |
| `onStationSelect` | `(station) => void` | —       | Called with a nearby station when it is picked |
| `className`       | `string`            | —       | Extra classes for the outer element            |

### `<CurrentStation>`

A tidal current station's page, with the same layout as `<TideStation>`: a `<CurrentScrubber>`, a **Next max** tile with the speed and time of the next maximum flood or ebb beside the Moon tile, the week's slacks and maxima with their set, where the predictions come from, the station's details, and the nearest stations. A maximum in the top tenth of its own direction's maxima over the fifteen days either side of the opening day reads "Strong flood" or "Strong ebb", and "Hardest flood" or "Hardest ebb" when nothing in that window runs harder. Stations whose predictions can't be served, such as CHS stations, show the reason instead. The current components need `@slackwater/api` 1.0.0-beta.3 or later, which serves the `/currents` routes. The tide components need 1.0.0-beta.4 or later, which flags the tide stations it can't predict and serves the bare IDs of the CHS records.

```tsx
<CurrentStation id="noaa/PUG1701" />
<CurrentStation id="noaa/EPT0003@11" threshold={1} />
```

| Prop              | Type                | Default | Description                                                        |
| ----------------- | ------------------- | ------- | ------------------------------------------------------------------ |
| `id`              | `string`            | —       | Station ID, optionally with a depth bin (e.g. `"noaa/EPT0003@11"`) |
| `threshold`       | `number`            | `0.5`   | Boat speed in knots that sizes the slack windows                   |
| `onStationSelect` | `(station) => void` | —       | Called with a nearby station when it is picked                     |
| `className`       | `string`            | —       | Extra classes for the outer element                                |

A nearby station's `kind` (`"tide"` or `"current"`) says which page it belongs on.

### `<TideScrubber>`

A tide timeline that scrolls under a fixed reading line. The lead reads the height and whether the tide is rising, falling, high, or low at the selected moment. The water is shaded amber where it drops below chart datum, unless `chartDatum` is `false`, and the curve turns from blue through yellow to red where the tide moves faster than 0.6 m an hour. Each high and low carries its height and time, and the vertical scale follows the water in view. Drag, scroll, tap, or use the arrow keys (Shift moves between events). Used by `<TideStation>`, and available on its own.

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

| Prop         | Type              | Default         | Description                                                                                        |
| ------------ | ----------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `timeline`   | `TimelineEntry[]` | —               | Heights above chart datum; fewer than two shows a message                                          |
| `extremes`   | `Extreme[]`       | —               | Highs and lows                                                                                     |
| `timezone`   | `string`          | —               | Station IANA time zone for clocks, dates, and days                                                 |
| `latitude`   | `number`          | —               | Station latitude, for sunrise and sunset                                                           |
| `longitude`  | `number`          | —               | Station longitude, for sunrise and sunset                                                          |
| `units`      | `Units`           | —               | The units of `timeline` and `extremes`                                                             |
| `chartDatum` | `boolean`         | `true`          | `false` when the heights aren't above a chart datum (a response without `datum`), so 0 is unmarked |
| `locale`     | `string`          | reader's locale | BCP 47 locale for clocks and dates                                                                 |
| `now`        | `number`          | the clock       | The current instant in ms; pass it to render deterministically                                     |
| `className`  | `string`          | —               | Extra classes for the outer element                                                                |

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

The tide now, after the app's small home-screen widget: the station's name, the height with an arrow for rising or falling, and the curve from half a swing back to a swing and a half ahead, whose labels name the next highs and lows. It is 170 px tall, or the parent's height with `fill`. Pass data, or a station ID to fetch it; a station the API can't serve, such as `chs-campbell-river`, shows the reason instead.

```tsx
<TideConditions id="noaa/9447130" />
<TideConditions name="Seattle" timeline={timeline} extremes={extremes} units="meters" timezone="UTC" />
```

| Prop                                        | Type      | Default   | Description                                                                                |
| ------------------------------------------- | --------- | --------- | ------------------------------------------------------------------------------------------ |
| `id`                                        | `string`  | —         | Station ID to fetch, in place of the data props                                            |
| `timeline`, `extremes`, `units`, `timezone` | —         | —         | The predictions to show                                                                    |
| `name`                                      | `string`  | —         | The station's name, with the data props                                                    |
| `chartDatum`                                | `boolean` | `true`    | With the data props, `false` when the heights aren't above a chart datum, so 0 is unmarked |
| `fill`                                      | `boolean` | `false`   | Fill the parent's height                                                                   |
| `now`                                       | `number`  | the clock | The current instant in ms; pass it to render deterministically                             |
| `className`                                 | `string`  | —         | Extra classes for the outer element                                                        |

### `<StationCard>`

A station's card, after the app's: its name and region, the reading now (height and rising or falling for a tide; speed, flooding, ebbing, or slack, and the set for a current), and a curve from one and a half swings back to two and a half ahead with each high, low, maximum, and slack window. The card loads its own predictions once it scrolls near the viewport, with a skeleton until then. A station the API can't serve shows only its name and region.

```tsx
<StationCard station={station} onSelect={(station) => navigate(station)} />
<StationCard station={station} href={`/stations/${station.id}`} distance={2.3} />
```

| Prop        | Type                | Default   | Description                                                                                                                                                                            |
| ----------- | ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `station`   | `StationSummary`    | —         | The station, from a listing; its `kind` picks the predictions                                                                                                                          |
| `distance`  | `number`            | —         | Kilometers away, shown in nautical miles                                                                                                                                               |
| `href`      | `string`            | —         | Makes the card a link                                                                                                                                                                  |
| `onSelect`  | `(station) => void` | —         | Called when the card is activated; makes it a button without `href`. With `href`, a plain click calls it in place of following the link, and a modified or middle click opens the link |
| `threshold` | `number`            | `0.5`     | Boat speed in knots that sizes a current's slack windows                                                                                                                               |
| `now`       | `number`            | the clock | The current instant in ms; pass it to render deterministically                                                                                                                         |
| `className` | `string`            | —         | Extra classes for the card                                                                                                                                                             |

### `<StationSearch>`

Station search after the app's: a field, an All / Tides / Currents filter, and the matching tide and current stations as `<StationCard>`s in a grid. Matches in a station's name come before matches in its region. It shows the first 60 and says so, or "No matches".

```tsx
<StationSearch onSelect={(station) => console.log(station.kind, station.id)} />
```

| Prop          | Type                | Default                     | Description                                      |
| ------------- | ------------------- | --------------------------- | ------------------------------------------------ |
| `onSelect`    | `(station) => void` | —                           | Called with the picked station, including `kind` |
| `placeholder` | `string`            | `"Harbor, bay, or channel"` | The field's placeholder and label                |
| `className`   | `string`            | —                           | Extra classes for the outer element              |

### `<NearbyStations>`

The tide and current stations nearest a station or a position, as `<StationCard>`s with their distance, nearest first. With `stationId`, the station itself is left out; pass `kind="current"` when it is a current station.

```tsx
<NearbyStations stationId="noaa/9447130" maxResults={5} />
<NearbyStations stationId="noaa/PUG1701" kind="current" />
<NearbyStations latitude={47.6} longitude={-122.3} />
```

| Prop                    | Type                  | Default  | Description                                         |
| ----------------------- | --------------------- | -------- | --------------------------------------------------- |
| `stationId`             | `string`              | —        | Measure from this station, leaving it out           |
| `kind`                  | `"tide" \| "current"` | `"tide"` | Which routes serve `stationId`                      |
| `latitude`, `longitude` | `number`              | —        | Measure from a position instead                     |
| `maxResults`            | `number`              | `5`      | How many stations to show                           |
| `onStationSelect`       | `(station) => void`   | —        | Called with the picked station, including `kind`    |
| `onHover`, `onHoverEnd` | `(station) => void`   | —        | Called as a station is hovered or focused, and left |
| `className`             | `string`              | —        | Extra classes for the list                          |

Without the API's `/currents` routes, the search and nearby lists show tide stations only.

### `<StationsMap>`

The app's stations map: every tide and current station in view as a live pin on OpenFreeMap's dark [fiord](https://openfreemap.org) style, north up. A tide is a gauge filled to where the water sits between its last and next turn, teal and pointing up while rising, amber and pointing down while falling. A current is an arrow toward its set, green at slack and otherwise colored by its speed. A station whose state isn't known yet is a steel dot, and one the API can't serve is a hollow ring. Readings ("3.2 ft", "1.8 kn"), gauges, and arrows appear from zoom 9.5 and names from 10.5. Below 9.5 every pin is a dot, in its tide or current color where its predictions are already loaded and steel otherwise. Each 44 px cell keeps one station, a harmonic station before a subordinate.

A tap picks the nearest pin and shows its `<StationCard>` in a panel along the bottom, under the "Not for navigation." notice; tapping the card calls `onStationSelect`, and tapping the water closes it. The locate button centers the map on the reader at zoom 10.5. Requires `maplibre-gl` and `react-map-gl`.

```tsx
<StationsMap
  initialViewState={{ longitude: -122.45, latitude: 47.65, zoom: 10 }}
  onStationSelect={(station) => navigate(`/stations/${station.kind}/${station.id}`)}
/>
```

| Prop              | Type                | Default           | Description                                                      |
| ----------------- | ------------------- | ----------------- | ---------------------------------------------------------------- |
| `onStationSelect` | `(station) => void` | —                 | Called when the selected station's card is tapped                |
| `onBoundsChange`  | `(bounds) => void`  | —                 | Called with the visible bounds each time the camera settles      |
| `focusStation`    | `string`            | —                 | A station ID to mark as selected without opening its card        |
| `showGeolocation` | `boolean`           | `true`            | Show the locate button                                           |
| `threshold`       | `number`            | `0.5`             | Boat speed in knots at or under which a current is slack         |
| `now`             | `number`            | the clock         | The current instant in ms; pass it to render deterministically   |
| `mapStyle`        | style or URL        | OpenFreeMap fiord | The basemap; station text uses the `Noto Sans Regular` fontstack |
| `className`       | `string`            | —                 | Extra classes for the outer element                              |

Other props pass through to react-map-gl's `<Map>`, and the forwarded ref is its `MapRef`. A custom `mapStyle` must serve the `Noto Sans Regular` fontstack from its `glyphs`, or the station names and readings don't draw.

Station listings load by bounding box once the camera settles, padded by half the view so a small pan needs nothing new. From zoom 9.5, each station in view loads the same predictions its card does (a tide's timeline and extremes, a current's timeline), so the card in the panel opens without another request. Pins update each minute from what is loaded, and a new window loads on the hour.

### `<StationDisclaimers>`

A station's disclaimers as a paragraph, or nothing when it has none.

## Hooks

All hooks must be used within a `<SlackwaterProvider>`.

- `useStation(id)` — fetch a single tide station
- `useStations({ query?, bbox?, latitude?, longitude? })` — search or list stations (a bounding box is `"minLon,minLat,maxLon,maxLat"`)
- `useNearbyStations({ latitude, longitude, maxResults? })` — fetch the stations nearest a position
- `useTimeline({ id, start?, end?, units? }, options?)` — fetch a tide height timeline
- `useExtremes({ id, start?, end?, units? }, options?)` — fetch highs and lows
- `useCurrentStation(id)` — fetch a current station
- `useCurrentStations({ query?, bbox?, latitude?, longitude? })` — search or list current stations
- `useCurrentEvents(id, { start, end })` — fetch slack, max flood, and max ebb events
- `useCurrentTimeline(id, { start, end })` — fetch the signed current speed timeline
- `useCurrentLevel(timeline)` — the water level now, interpolated and updated each minute
- `useThemeColors()` — the map's colors, resolved from the theme variables

`timelineQuery`, `extremesQuery`, and `currentTimelineQuery` return the query key and function those hooks use, for `useQueries` or a prefetch that should share their cache.

`useTimeline` and `useExtremes` also take a location (`{ latitude, longitude }`) in place of an `id`. They take no `datum`, so every reader of a station shares the API's default, its chart datum; the `fetch*` client functions still pass one through. Their `options` set `enabled`, `staleTime`, and `placeholderData`.

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

See `styles.css` for the full set, including the sun, card, map, and type variables. The speed and tide-rate ramp is fixed, the same as the app's.

## License

MIT
