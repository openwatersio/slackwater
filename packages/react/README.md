# @slackwater/react

React components for tide and current predictions powered by [Slackwater](https://openwaters.io/tides/slackwater/). They follow the design of the Slackwater app: a dark theme, a timeline you scrub under a fixed reading line, and a week's schedule beneath it.

## Installation

```sh
npm install @slackwater/react
```

Peer dependencies:

```sh
npm install react react-dom
# Required for station pages and <StationsMap>
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

`<SlackwaterProvider>` configures the data source and the reader's preferences for every component inside it. There is no datum setting: as in the app, tide heights are above the station's chart datum wherever it has one.

```tsx
<SlackwaterProvider baseUrl="https://api.example.com" units="feet">
  {children}
</SlackwaterProvider>
```

| Prop          | Type                     | Default                            | Description                                                      |
| ------------- | ------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `baseUrl`     | `string`                 | —                                  | API server URL; required unless `dataSource` is supplied         |
| `dataSource`  | `SlackwaterDataSource`   | —                                  | Local or remote source; takes precedence over `baseUrl`          |
| `units`       | `"meters" \| "feet"`     | feet for `en-US`, otherwise meters | Height units                                                     |
| `setFormat`   | `"compass" \| "degrees"` | `"compass"`                        | Current direction display, shared by visible and spoken readings |
| `timezone`    | `string`                 | the station's time zone            | Time zone for `<TideConditions>`                                 |
| `locale`      | `string`                 | `navigator.language`               | BCP 47 locale for clocks, dates, and numbers                     |
| `queryClient` | `QueryClient`            | created for you                    | A TanStack Query client, for example one hydrated on the server  |

## Local and precomputed data

Pass a `SlackwaterDataSource` to use your own station catalogue and predictions. The React package depends on `@slackwater/engine` for its readings but not on the station database or a prediction catalogue, so predictions still come from your data source. Your adapter implements all eight methods: tide station lookup, listing, timeline and extremes, plus current station lookup, listing, events and timeline. The exported interface uses the same request and response types as the HTTP client.

```tsx
import { SlackwaterProvider, TideStation, type SlackwaterDataSource } from "@slackwater/react";
import { localDataSource } from "./local-data-source.js";

const source: SlackwaterDataSource = localDataSource;

function App() {
  return (
    <SlackwaterProvider dataSource={source} units="meters">
      <TideStation id="noaa/9447130" />
    </SlackwaterProvider>
  );
}
```

Keep the source object stable across renders. Its nonempty `cacheKey` identifies the dataset, revision, and access policy, for example `local:catalog-v3:public`. Equivalent sources on the server and client must use the same key; change it when their data or permissions differ. Keys are visible in query caches, so keep credentials out of them. Queries from different sources are isolated even when they share a `QueryClient`. Changing the key remounts the provider's children to clear selections and pending placeholders from the preceding source.

Return `Date` objects in prediction responses, heights in the requested units, and current speeds in knots. Preserve current IDs with their `@bin` suffix. Listing methods must honor the search, bounding-box, distance, and result-limit parameters they receive. Sources own errors, station availability, licensing, and any network or engine work. Set `predictions: false` and `unavailable` on unavailable station metadata and listing records so pages, cards, and map pins can avoid requesting predictions and explain their absence.

`createApiDataSource(baseUrl, { cacheKey? })` creates the HTTP adapter used by the `baseUrl` prop. Its default cache identity includes the current-event contract revision (`minima-v1`) and a SHA-256 digest of the normalized URL, stable across server and browser without putting the URL text into the cache. If server prefetch uses an internal address and the browser uses a public address for the same dataset and access policy, construct an adapter on each side with the same explicit key, for example `createApiDataSource(apiUrl, { cacheKey: "public-catalog:v3" })`, and pass it to prefetch and the provider. Explicit keys and URL digests appear in dehydrated caches. A digest is an identifier, not encryption; use an explicit nonsecret key for private URLs. Different datasets or permissions must keep different keys. The URL-derived default does not detect catalog revisions or cookie/session policy changes; use explicit keys that change with those values. `useSlackwaterConfig().dataSource` is always present; its `baseUrl` is optional when a source is injected.

## Current event contracts and rollout

Current events include `minFlood` and `minEbb` lulls; their readings are “Minimum flood” and “Minimum ebb”. They remain schedule and scrubber destinations, while Next max and peak rankings use only true maxima. Pair this client with the API version that supports minimum kinds. Event requests negotiate `eventRevision=minima-v1` and require the same revision in the response; old-server and stale-cache responses fail explicitly. The API keeps legacy phase labels for clients that omit the revision. The query separates old HTTP responses, and every current-events query key includes the revision, including queries using an explicit host cache key. Hosts must still change source keys when their dataset or access policy changes.

Deploy the API supporting `minima-v1` before the revised client. If an older API has already served the revisioned URLs, purge those HTTP/CDN entries or wait the configured `SLACKWATER_API_MAX_AGE` (default 3,600 seconds) after upgrading the API before deploying the client. An API rollback deliberately fails revised current-event queries rather than showing legacy lulls as maxima; roll back the paired client or restore the API and clear or expire those cache entries.

## Components

### `<TideStation>`

A tide station's page, after the app's tide detail screen:

- the name and region over a `<TideScrubber>`, with the reading for the selected moment and pills for the next event and the way back to now;
- a full-width water tile above paired Moon and Sun cards (all three share a row in panes at least 700 px wide). **Range** is the height between the turn behind it and the turn ahead, captioned "low to high" or "high to low". When that swing is in the top tenth of every swing in the fifteen days either side of the day the page opened, the caption says "beyond normal here", or "the fortnight's biggest" when no swing in that window is bigger. **Moon** names the phase and the tide the Moon is driving: spring or neap, perigean or apogean within two days of perigee or apogee, or how much of it is lit. Sun names the next sunrise or sunset and the selected day's daylight duration. Range includes seven daily swing bars from a complete week of extremes, highlighting the selected day;
- a schedule card with the week's highs and lows, a day at a time with sunrise, solar noon, and sunset. The row nearest the selection is highlighted, and choosing a row moves the scrubber there. The week bar opens a date picker;
- where the predictions come from and the station's disclaimers, and a "Station details" disclosure with its datum, ID, position, time zone, and reference station;
- the three nearest tide and current stations in the same list layout as search, with All, Tides and Currents filters and a 220 px map below. The map frames the page's station and the listed stations; tapping a pin selects it directly. A collapsed Data sources disclosure below combines the page station’s credit with those of the nearby stations.

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

Current readings show full predicted speed and **Set**, the direction water flows toward, measured clockwise from true north. Set uses 16-point compass labels by default, such as `SW`. Set `setFormat="degrees"` on the provider to show a three-digit bearing such as `225°`, or read `const updateConfig = useUpdateConfig()` in your settings component and call `updateConfig({ setFormat: "degrees" })` from its change handler. A valid saved choice takes precedence over the provider’s initial `setFormat` prop, as it does for height units. The choice persists with the reader’s other preferences. Settings can label the option “Degrees °T” to explain true north; readings omit the T and show only the chosen format. Standalone components inherit the provider preference unless their own `setFormat` prop overrides it; without a provider they default to compass. Custom current components can use the exported `useSetFormat()` hook. Spoken compass readings use full direction names, such as “north-northeast.” Schedule bearings speak full direction names and identify their published source. They follow the same format preference but represent the station’s published flood/ebb headings. Fixed flood/ebb bearings in station details stay in degrees, without a T suffix.

With two-component predictions, Set follows the rotating current; without them, speed is the absolute flood/ebb component and Set uses the published flood/ebb bearings. Between samples, two-component readings interpolate the velocity vectors, including direction changes through north. A zero vector has no Set. Speed readings round to a tenth of a knot; nonzero flow can retain a Set when its displayed speed rounds to 0.0.

The graph, maximum flood/ebb events and axis windows use signed major-axis speed. Axis slack is a zero of that component; crossing flow can remain. The window threshold does not limit full speed, and axis zeros are not rotary-current minimum-speed predictions. Instantaneous readings do not infer a Slack state from these events.

A tidal current station's page, with the same layout as `<TideStation>`: a `<CurrentScrubber>`, a **Next max** tile with the speed and time of the next maximum flood or ebb above the Moon and Sun tiles, the week's axis zeros, maxima, and minima with their phase bearings, where the predictions come from, the station's details, and the nearest stations. Main and nearby station credits appear once in the Data sources disclosure at the end of the nearby section. A maximum in the top tenth of its own direction's maxima over the fifteen days either side of the opening day reads "Strong flood" or "Strong ebb", and "Hardest flood" or "Hardest ebb" when nothing in that window runs harder. Stations whose predictions can't be served, such as CHS stations, show the reason instead. Use the API beta from the same release as these components. It must include attribution and license fields on station listings, tide availability flags, and direct lookups for unprefixed CHS records; the published API 1.0.0-beta.4 does not include those additions.

```tsx
<CurrentStation id="noaa/PUG1701" />
<CurrentStation id="noaa/EPT0003@11" threshold={1} />
```

| Prop              | Type                | Default | Description                                                        |
| ----------------- | ------------------- | ------- | ------------------------------------------------------------------ |
| `id`              | `string`            | —       | Station ID, optionally with a depth bin (e.g. `"noaa/EPT0003@11"`) |
| `threshold`       | `number`            | `0.5`   | Major-axis speed in knots that sizes the axis windows              |
| `onStationSelect` | `(station) => void` | —       | Called with a nearby station when it is picked                     |
| `className`       | `string`            | —       | Extra classes for the outer element                                |

A nearby station's `kind` (`"tide"` or `"current"`) says which page it belongs on.

### `<TideScrubber>`

A tide timeline that scrolls under a fixed reading line. The lead reads the height and whether the tide is rising, falling, high, or low at the selected moment, including the rate when it reaches 0.6 m/hour. The pill names the next high, low, fastest rise/fall, or earlier sunrise/sunset, always moving forward. The water is shaded amber where it drops below chart datum, unless `chartDatum` is `false`, and the curve turns from blue through yellow to red where the tide moves faster than 0.6 m an hour. Each high and low carries its height and time in its event color, and the vertical scale follows the water in view. Drag, scroll, tap, or use the arrow keys (Shift moves between events). Used by `<TideStation>`, and available on its own.

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
| `bounded`    | `boolean`         | `false`         | Pad both ends so every supplied sample can reach the fixed reading line                            |
| `className`  | `string`          | —               | Extra classes for the outer element                                                                |

### `<CurrentScrubber>`

The current timeline: full predicted speed and Set at the selected moment above a signed flood/ebb graph, blue axis windows sized by an along-axis speed threshold and short green strokes at the exact slack instants, a curve threaded by speed, and the component speed and published flood/ebb bearing at each maximum. The lead shows full speed and Set even at a major-axis zero. Graph event labels identify the flood/ebb component separately. The pill walks through window opening, zero, window closing and maxima, competing with sunrise and sunset. A zero threshold turns windows off while retaining exact slacks. Window edges follow the signed sampled curve. Touching or overlapping windows merge; a continuous window spanning several slacks shows their exact times in green, while an ordinary window shows its opening. Maximum flood and ebb times appear on a separate gray row beneath the green axis-zero times. Without a window, the curve stays yellow. Used by `<CurrentStation>`, and available on its own.

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

| Prop         | Type                     | Default                    | Description                                                                                                                |
| ------------ | ------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `timeline`   | `CurrentTimelineEntry[]` | —                          | Signed major-axis speeds in knots, with magnitude and direction when known, flood positive; fewer than two shows a message |
| `events`     | `CurrentEvent[]`         | —                          | Slack and flood/ebb maxima and minima                                                                                      |
| `timezone`   | `string`                 | —                          | Station IANA time zone for clocks, dates, and days                                                                         |
| `latitude`   | `number`                 | —                          | Station latitude, for sunrise and sunset                                                                                   |
| `longitude`  | `number`                 | —                          | Station longitude, for sunrise and sunset                                                                                  |
| `setFormat`  | `"compass" \| "degrees"` | provider, else `"compass"` | Direction override; otherwise inherits the provider or defaults to compass                                                 |
| `directions` | `{ flood?, ebb? }`       | `{}`                       | Flood and ebb set in degrees true                                                                                          |
| `threshold`  | `number`                 | `0.5`                      | Major-axis speed in knots that sizes the axis windows                                                                      |
| `locale`     | `string`                 | reader's locale            | BCP 47 locale for clocks and dates                                                                                         |
| `now`        | `number`                 | the clock                  | The current instant in ms; pass it to render deterministically                                                             |
| `bounded`    | `boolean`                | `false`                    | Pad both ends so every supplied sample can reach the fixed reading line                                                    |
| `className`  | `string`                 | —                          | Extra classes for the outer element                                                                                        |

Set `bounded` on either scrubber for a finite window supplied by your application, such as one CHS day fetched directly in its browser. The scrubber does not fetch CHS predictions. Empty space on either side lets every supplied sample reach the fixed center line at the same 18 pixels per hour, including on a pane wider than the data. Selections clamp to the first and last samples; no curve is extrapolated. The default remains the continuous multi-day strip. A bounded scrubber displays only its supplied data and does not request or rank a fortnight of predictions. When the clock is outside the supplied span, Now means the nearest available endpoint; changing days or loading another window belongs to the host.

When no following high or low is supplied, the scrubber, station card, and widget derive their trend from the samples. A flat series defaults to rising.

Both scrubbers also take `onSelect(time)`, called as the selected moment changes, `moveTo`, an object whose `time` the strip moves to each time a new object is passed, and `onNow(now)`, called when the reader returns to now.

### `<TideConditions>`

The tide now, after the app's small home-screen widget: the station's name, the height with an arrow for rising or falling, and the curve from half a swing back to a swing and a half ahead, whose labels name the next highs and lows. It is 170 px tall, or the parent's height with `fill`, with the station's credit under it. Pass data, or a station ID to fetch it; a station the API can't serve, such as `chs-campbell-river`, shows the reason instead.

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
| `attribution`                               | `string`  | —         | With the data props, the station's `attribution`, printed under the widget                 |
| `fill`                                      | `boolean` | `false`   | Fill the parent's height                                                                   |
| `now`                                       | `number`  | the clock | The current instant in ms; pass it to render deterministically                             |
| `className`                                 | `string`  | —         | Extra classes for the outer element                                                        |

### `<StationCard>`

A station's card, after the app's: its name and region, the reading now (height and rising or falling for a tide; full predicted speed and Set for a current), and a curve from one and a half swings back to two and a half ahead with each high, low, maximum, and slack window. The card loads its own predictions once it scrolls near the viewport, with a skeleton until then. A station the API can't serve shows only its name and region. The card has no room for its station's credit, so put a `<StationCredits>` Data sources disclosure under the cards you show. Current cards show full predicted speed and Set above the signed flood/ebb curve, with axis windows in blue and exact axis zeros marked by short green strokes even when the window is off. The numeric reading and graph describe different quantities when crossing flow is present.

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
| `threshold` | `number`            | `0.5`     | Major-axis speed in knots that sizes a current's axis windows                                                                                                                          |
| `now`       | `number`            | the clock | The current instant in ms; pass it to render deterministically                                                                                                                         |
| `className` | `string`            | —         | Extra classes for the card                                                                                                                                                             |

### `<StationSearch>`

Station search after the app's: a field, an All / Tides / Currents filter, and the matching tide and current stations as `<StationCard>`s in a grid. Matches in a station's name come before matches in its region. It shows the first 60 and says so, or "No matches". The credits of the stations shown follow the results in a collapsed Data sources disclosure, as `<StationCredits>`.

```tsx
<StationSearch onSelect={(station) => console.log(station.kind, station.id)} />
```

| Prop          | Type                | Default                     | Description                                      |
| ------------- | ------------------- | --------------------------- | ------------------------------------------------ |
| `onSelect`    | `(station) => void` | —                           | Called with the picked station, including `kind` |
| `placeholder` | `string`            | `"Harbor, bay, or channel"` | The field's placeholder and label                |
| `className`   | `string`            | —                           | Extra classes for the outer element              |

### `<NearbyStations>`

The tide and current stations nearest a station or a position, as `<StationCard>`s with their distance, nearest first. With `stationId`, the station itself is left out; pass `kind="current"` when it is a current station. The credits of the stations listed follow the list in a collapsed Data sources disclosure, as `<StationCredits>`. Pass `attribution` to include the originating station’s credit in the same disclosure.

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
| `showMap`               | `boolean`             | `false`  | Show a framed map below the list                    |
| `filter`                | `"tide" \| "current"` | —        | Restrict the list to one station kind               |
| `onStationSelect`       | `(station) => void`   | —        | Called with the picked station, including `kind`    |
| `onHover`, `onHoverEnd` | `(station) => void`   | —        | Called as a station is hovered or focused, and left |
| `className`             | `string`              | —        | Extra classes for the list                          |

Without the API's `/currents` routes, the search and nearby lists show tide stations only.

### `<StationsMap>`

The app's stations map: every tide and current station in view as a live pin on OpenFreeMap's dark [fiord](https://openfreemap.org) style, north up. A tide is a gauge filled to where the water sits between its last and next turn, teal and pointing up while rising, amber and pointing down while falling. A current is an arrow toward its set, green at slack and otherwise colored by its speed. A station whose state isn't known yet is a steel dot, and one the API can't serve is a hollow ring. Readings ("3.2", "1.8"), gauges, and arrows appear from zoom 9.5 and names from 10.5. Below 9.5 every pin is a dot, in its tide or current color where its predictions are already loaded and steel otherwise. Each 44 px cell keeps one station, a harmonic station before a subordinate.

A tap picks the nearest pin and shows its `<StationCard>` in a panel along the bottom, above the unit legend; tapping the card calls `onStationSelect`, and tapping the water closes it. The bottom legend pairs a dot with Tides and the provider's height unit, an arrow with Currents and kn, and “Not for navigation.” beneath them. Framed Nearby maps use `showLegend={false}` and keep units beside each reading. The map’s attribution initially shows credits for five seconds before folding to ⓘ and credits the basemap, the selected station, and every station in view whose predictions color its pin. The locate button centers the map on the reader at zoom 10.5. Requires `maplibre-gl` and `react-map-gl`, also needed for the embedded maps on station pages.

```tsx
<StationsMap
  initialViewState={{ longitude: -122.45, latitude: 47.65, zoom: 10 }}
  onStationSelect={(station) => navigate(`/stations/${station.kind}/${station.id}`)}
/>
```

| Prop              | Type                | Default           | Description                                                                |
| ----------------- | ------------------- | ----------------- | -------------------------------------------------------------------------- |
| `onStationSelect` | `(station) => void` | —                 | Called when the selected station's card is tapped                          |
| `onBoundsChange`  | `(bounds) => void`  | —                 | Called with the visible bounds each time the camera settles                |
| `focusStation`    | `string`            | —                 | A station ID to mark as selected without opening its card                  |
| `showLegend`      | `boolean`           | `true`            | Unit legend below the selected card; false keeps units beside pin readings |
| `onPinSelect`     | `(station) => void` | —                 | Opens a picked pin directly, without a card panel                          |
| `showGeolocation` | `boolean`           | `true`            | Show the locate button                                                     |
| `threshold`       | `number`            | `0.5`             | Comfort threshold for the selected card's graph                            |
| `now`             | `number`            | the clock         | The current instant in ms; pass it to render deterministically             |
| `mapStyle`        | style or URL        | OpenFreeMap fiord | The basemap; station text uses the `Noto Sans Regular` fontstack           |
| `className`       | `string`            | —                 | Extra classes for the outer element                                        |

Other props pass through to react-map-gl's `<Map>`, and the forwarded ref is its `MapRef`. A custom `mapStyle` must serve the `Noto Sans Regular` fontstack from its `glyphs`, or the station names and readings don't draw.

Station listings load by bounding box once the camera settles, padded by half the view so a small pan needs nothing new. From zoom 9.5, each station in view loads the same predictions its card does (a tide's timeline and extremes, a current's timeline and events), so the card in the panel opens without another request. Pins update each minute from what is loaded, and a new window loads on the hour.

### `<StationCredits>`

The credits owed for a set of stations, each distinct `attribution` once, in a collapsed Data sources disclosure. A credit another contains is left out, so NOAA stations, whose credit is only the database's, add nothing beside a Kartverket or TICON station. Renders nothing when no station carries one.

```tsx
<StationCredits stations={shownStations} />
```

| Prop        | Type                 | Default | Description                                              |
| ----------- | -------------------- | ------- | -------------------------------------------------------- |
| `stations`  | `{ attribution? }[]` | —       | The stations whose credits are available in Data sources |
| `className` | `string`             | —       | Extra classes for the outer element                      |

### `<StationDisclaimers>`

A station's disclaimers as a paragraph, or nothing when it has none.

## Station licenses

Each station's data carries a license, in its `license` (`type`, `commercial_use`, `url`, `notes`), and a credit, in its `attribution`. The station pages and search and nearby lists collect credits in Data sources disclosures; maps use their attribution control, and the widget prints its credit below the card. Keep the full attribution available wherever you show predictions another way. The components don't filter by license: a commercial product must leave out stations marked `commercial_use: false`, the TICON records under CC BY-NC 4.0. `license` and `attribution` come with every listing from an API that includes them.

Commercial hosts must use a source that excludes records with `license.commercial_use: false` from both listings and direct prediction requests. The stock API and components do not apply that exclusion; an HTTP deployment needs a filtered API or proxy. An injected source owns the same checks. Hosts must keep CHS fetching in the browser where required by its access terms and refuse CHS prediction requests on their server-side source. The React interface does not enforce redistribution or commercial-use policy; the host must enforce both.

## Hooks

All hooks must be used within a `<SlackwaterProvider>`.

- `useStation(id)` — fetch a single tide station
- `useStations({ query?, bbox?, latitude?, longitude? })` — search or list stations (a bounding box is `"minLon,minLat,maxLon,maxLat"`)
- `useNearbyStations({ latitude, longitude, maxResults? })` — fetch the stations nearest a position
- `useTimeline({ id, start?, end?, units? }, options?)` — fetch a tide height timeline
- `useExtremes({ id, start?, end?, units? }, options?)` — fetch highs and lows
- `useCurrentStation(id)` — fetch a current station
- `useCurrentStations({ query?, bbox?, latitude?, longitude? })` — search or list current stations
- `useCurrentEvents(id, { start, end })` — fetch slack and flood/ebb maxima and minima
- `useCurrentTimeline(id, { start, end })` — fetch the signed current speed timeline
- `useCurrentLevel(timeline)` — the water level now, interpolated and updated each minute
- `useThemeColors()` — the map's colors, resolved from the theme variables

`timelineQuery`, `extremesQuery`, `currentTimelineQuery`, and `currentEventsQuery` return the query key and function those hooks use, for `useQueries` or a prefetch that should share their cache. Tide builders accept a config with `baseUrl` or `dataSource` and `units`; current builders accept a URL or source as their first argument.

Every hook scopes its query key by the source's `cacheKey`. When seeding caches manually, pass that key as the last argument to `queryKeys.station`, `queryKeys.timeline`, or the corresponding key builder. Calling these without a source still returns an unscoped prefix suitable for invalidation across sources, but does not address a hook's cached result.

`useTimeline` and `useExtremes` also take a location (`{ latitude, longitude }`) in place of an `id`. They take no `datum`, so every reader of a station shares the API's default, its chart datum; the `fetch*` client functions still pass one through. Their `options` set `enabled`, `staleTime`, and `placeholderData`.

## Server rendering

`prefetchTideStation(queryClient, baseUrlOrSource, id, { units?, locale?, now? })` fills the station, prediction windows, and Nearby lists for `<TideStation>`. A subordinate station's reference metadata loads separately. `prefetchNearbyStations` fills the lists for `<NearbyStations>`. Pass `dehydrate(queryClient)` to the client and render inside a `<HydrationBoundary>`; both are re-exported from TanStack Query. Both prefetch helpers accept a URL or a `SlackwaterDataSource`; render with an equivalent source and matching units on the client.

The hydrated cache contains data, not the source's methods. Reconstruct the source on the client with the same `cacheKey`. If your framework serializes the cache, use a serializer that preserves `Date` values or revive them before hydration. Plain JSON turns dates into strings and is insufficient for these responses.

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
