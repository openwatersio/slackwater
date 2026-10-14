# @slackwater/react

React components for tide and current predictions powered by [Slackwater](https://openwaters.io/tides/slackwater/).

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

## Quick Start

Wrap your app with `<SlackwaterProvider>` and point it at a running [`@slackwater/api`](../api) instance:

```tsx
import { SlackwaterProvider, TideStation } from "@slackwater/react";
import "@slackwater/react/styles.css";

function App() {
  return (
    <SlackwaterProvider baseUrl="https://api.example.com">
      <TideStation id="noaa/8443970" />
    </SlackwaterProvider>
  );
}
```

## Components

## Provider

`<SlackwaterProvider>` configures the API base URL, default units, and datum for all child components.

```tsx
<SlackwaterProvider baseUrl="https://api.example.com" units="feet" datum="MLLW">
  {children}
</SlackwaterProvider>
```

| Prop          | Type                 | Default      | Description                    |
| ------------- | -------------------- | ------------ | ------------------------------ |
| `baseUrl`     | `string`             | —            | API server URL                 |
| `units`       | `"meters" \| "feet"` | `"meters"`   | Display units                  |
| `datum`       | `string`             | chart datum  | Vertical datum (e.g. `"MLLW"`) |
| `queryClient` | `QueryClient`        | auto-created | Custom TanStack Query client   |

### `<TideStation>`

All-in-one display for a single station — name, graph, and table.

```tsx
<TideStation id="noaa/8443970" />
```

| Prop        | Type                          | Default | Description                        |
| ----------- | ----------------------------- | ------- | ---------------------------------- |
| `id`        | `string`                      | —       | Station ID (e.g. `"noaa/8443970"`) |
| `showGraph` | `boolean`                     | `true`  | Show tide graph                    |
| `showTable` | `boolean`                     | `true`  | Show extremes table                |
| `timeRange` | `TimeRange \| { start, end }` | `"24h"` | Time window                        |

### `<TideConditions>`

Current water level, rising/falling indicator, and next extreme. Used internally by `<TideStation>` but also available standalone.

```tsx
<TideConditions timeline={timeline} extremes={extremes} units="meters" />
```

### `<TideGraph>`

Tide level chart. Pass data directly or fetch by station ID.

```tsx
// Fetch mode
<TideGraph id="noaa/8443970" />

// Data mode
<TideGraph timeline={data} timezone="America/New_York" units="feet" />
```

### `<TideTable>`

High/low tide extremes in a table. Pass data directly or fetch by station ID.

```tsx
<TideTable id="noaa/8443970" days={3} />
```

### `<StationSearch>`

Autocomplete search input for finding stations.

```tsx
<StationSearch onSelect={(station) => console.log(station)} />
```

### `<NearbyStations>`

List of stations near a given station or coordinates.

```tsx
<NearbyStations stationId="noaa/8443970" maxResults={5} />
<NearbyStations latitude={42.35} longitude={-71.05} />
```

### `<StationsMap>`

Interactive map showing tide stations within the visible viewport. Requires `maplibre-gl` and `react-map-gl`. Stations are fetched by bounding box as the user pans and zooms.

```tsx
<StationsMap
  mapStyle="https://tiles.example.com/style.json"
  onStationSelect={(station) => console.log(station)}
/>
```

### `<CurrentStation>`

Detail view for a tidal current station: name, region, a `<CurrentScrubber>` over a window from 96 hours before to 180 hours after the start of the station's local day, and the station's disclaimers and attribution. The window moves when the page is shown again two or more days later. Stations whose predictions can't be served, such as CHS stations, show the reason instead. The current components need `@slackwater/api` 1.0.0-beta.3 or later, which serves the `/currents` routes.

```tsx
<CurrentStation id="noaa/PUG1701" />
<CurrentStation id="noaa/EPT0003@11" threshold={1} />
```

| Prop        | Type     | Default | Description                                                        |
| ----------- | -------- | ------- | ------------------------------------------------------------------ |
| `id`        | `string` | —       | Station ID, optionally with a depth bin (e.g. `"noaa/EPT0003@11"`) |
| `threshold` | `number` | `0.5`   | Boat speed in knots that sizes the slack windows                   |
| `className` | `string` | —       | Extra classes for the outer element                                |

### `<CurrentScrubber>`

Current timeline that scrolls under a fixed reading line. It reads the speed, set, and state at the selected moment, and has pills for the next event and the way back to now. Drag, scroll, tap, or use the arrow keys (Shift moves between events). Used internally by `<CurrentStation>` but also available standalone.

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

## Hooks

All hooks must be used within a `<SlackwaterProvider>`.

- `useStation(id)` — fetch a single station
- `useStations({ query?, bbox?, latitude?, longitude? })` — search/list stations (supports bounding box as `"minLon,minLat,maxLon,maxLat"`)
- `useExtremes({ id, start?, end?, days? })` — fetch high/low extremes
- `useTimeline({ id, start?, end? })` — fetch tide level timeline
- `useNearbyStations({ stationId } | { latitude, longitude })` — fetch nearby stations
- `useCurrentStation(id)` — fetch a current station
- `useCurrentEvents(id, { start, end })` — fetch slack, max flood, and max ebb events
- `useCurrentTimeline(id, { start, end })` — fetch the signed current speed timeline

## Styling

Components are styled with [Tailwind CSS v4](https://tailwindcss.com) and CSS custom properties for theming.

### With Tailwind

Add `@slackwater/react` to your Tailwind content paths so its classes are included in your build:

```css
/* app.css */
@import "tailwindcss";
@source "../node_modules/@slackwater/react/dist";
```

Import the theme variables:

```css
@import "@slackwater/react/styles.css";
```

### Without Tailwind

Import the pre-built stylesheet which includes all resolved Tailwind utilities:

```tsx
import "@slackwater/react/styles.css";
```

### Theme Variables

Override CSS custom properties to match your brand:

```css
:root {
  --slackwater-primary: #2563eb;
  --slackwater-high: #3b82f6; /* High tide color */
  --slackwater-low: #f59e0b; /* Low tide color */
  --slackwater-bg: #ffffff;
  --slackwater-bg-subtle: #f8fafc;
  --slackwater-text: #0f172a;
  --slackwater-text-muted: #64748b;
  --slackwater-border: #e2e8f0;
}
```

### Dark Mode

Dark mode activates automatically based on the user's system preference via the CSS [`color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme) property. You can also force dark or light mode on any container:

```css
.my-widget {
  color-scheme: dark; /* or "light" */
}
```

Override dark mode colors using `light-dark()`:

```css
:root {
  --slackwater-primary: light-dark(#2563eb, #60a5fa);
  --slackwater-bg: light-dark(#ffffff, #0f172a);
  --slackwater-text: light-dark(#0f172a, #f1f5f9);
}
```

## License

MIT
