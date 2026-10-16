# @slackwater/api

HTTP API for tide and current predictions, built on [Slackwater](https://openwaters.io/tides/slackwater/). A hosted instance runs at [api.openwaters.io/tides](https://api.openwaters.io/tides/).

## Installation

```bash
npm install @slackwater/api
```

## Usage

### As a standalone server

```typescript
import { createApp } from "@slackwater/api";

const app = createApp();

app.listen(3000, () => {
  console.log("Server listening on port 3000");
});
```

### As an Express middleware

```typescript
import { createApp } from "@slackwater/api";
import express from "express";

const mainApp = express();

// Mount the API at a specific path: /api/tides/... and /api/currents/...
mainApp.use("/api", createApp());

mainApp.listen(3000, () => {
  console.log("Server listening on port 3000");
});
```

`createApp` mounts the tide routes at `prefix` (default `/tides`) and the current routes at `currentsPrefix` (default `/currents`). `currentsPrefix` must not equal or contain `prefix`, since the current routes are mounted first:

```typescript
createApp({ prefix: "/", currentsPrefix: "/currents" }); // /extremes, /stations, ... and /currents/events, ...
```

### As routers

`createRoutes()` returns the tide routes and `createCurrentRoutes()` the current routes, each with its own `/` and `/openapi.json`. Mount them wherever you like:

```typescript
import { createRoutes, createCurrentRoutes } from "@slackwater/api";
import express from "express";

const app = express();
app.use("/api/tides", createRoutes());
app.use("/api/currents", createCurrentRoutes());
```

## API Endpoints

### GET /tides/extremes

Get high and low tide predictions for the nearest station to given coordinates.

**Query Parameters:**

- `latitude` (required): Latitude (-90 to 90)
- `longitude` (required): Longitude (-180 to 180)
- `start` (required): Start date/time in ISO 8601 format
- `end` (required): End date/time in ISO 8601 format
- `datum` (optional): Vertical datum, defaults to station's chart datum
- `units` (optional): Units for water levels (meters or feet, defaults to meters)

**Example:**

```bash
curl "http://localhost:3000/tides/extremes?latitude=26.772&longitude=-80.05&start=2025-12-17T00:00:00Z&end=2025-12-18T00:00:00Z&datum=MLLW&units=feet"
```

### GET /tides/timeline

Get water level predictions at regular intervals for the nearest station.

**Query Parameters:** Same as `/extremes`

**Example:**

```bash
curl "http://localhost:3000/tides/timeline?latitude=26.772&longitude=-80.05&start=2025-12-17T00:00:00Z&end=2025-12-18T00:00:00Z"
```

### GET /tides/stations

Search stations or find them near a location.

**Query Parameters:**

- `query` (optional): Full-text search (name, ID, or location)
- `latitude` (optional): Latitude for proximity search
- `longitude` (optional): Longitude for proximity search
- `maxResults` (optional): Maximum number of stations to return (1-100, defaults to 10)
- `maxDistance` (optional): Maximum search radius for proximity search

**Examples:**

```bash
# Search stations by text
curl "http://localhost:3000/tides/stations?query=miami"

# Find stations near coordinates
curl "http://localhost:3000/tides/stations?latitude=26.772&longitude=-80.05&maxResults=5"

# Find stations within a specific distance
curl "http://localhost:3000/tides/stations?latitude=26.772&longitude=-80.05&maxDistance=100"
```

Every mode includes stations whose predictions can't be served, such as the Canadian Hydrographic Service ports, whose terms don't allow their predictions to be redistributed. Every tide station also carries:

- `predictions`: whether this API can serve predictions for the station
- `unavailable`: why not, when `predictions` is `false`
- `attribution`: the credit to display wherever the station's data is shown
- `license`: the station data's license (`type`, `commercial_use`, `url`, and sometimes `notes`). A commercial product must leave out stations marked `commercial_use: false`, the TICON records under CC BY-NC 4.0

### GET /tides/stations/:source/:id

Get a tide station by ID, with the same `predictions` and `unavailable`. The curated CHS records have no source prefix and are a single path segment: `/tides/stations/chs-campbell-river`.

### GET /tides/stations/:source/:id/extremes

Get extremes prediction for a specific station. The station ID is two path segments, with its slash left unencoded: `/tides/stations/noaa/8722588/extremes`. The bare IDs of the curated CHS records name stations whose predictions can't be served, so the prediction routes don't take them.

**Path Parameters:**

- `source` (required): The station's source, such as `noaa`
- `id` (required): The station's ID within that source, such as `8722588`

**Query Parameters:**

- `start` (optional): Start date/time in ISO 8601 format, defaults to now
- `end` (optional): End date/time in ISO 8601 format, defaults to 7 days from now
- `datum` (optional): Vertical datum, defaults to the station's chart datum when its `datums` include it. A station whose `datums` don't, such as `noaa/8519024` (chart datum `STND`, no datums), gives heights about mean sea level, and its response has no `datum`.
- `units` (optional): Units for water levels, `meters` (default) or `feet`

**Example:**

```bash
curl "http://localhost:3000/tides/stations/noaa/8722588/extremes?start=2025-12-17T00:00:00Z&end=2025-12-18T00:00:00Z"
```

### GET /tides/stations/:source/:id/timeline

Get timeline prediction for a specific station.

**Parameters:** Same as `/tides/stations/:source/:id/extremes`

### GET /tides/openapi.json

Get the OpenAPI 3.0 specification for this API.

## Tidal Current Endpoints

Current predictions are a sibling route group, served at `/currents/...` next to `/tides/...`, with their own OpenAPI document at `/currents/openapi.json`. Speeds are signed knots along the station's flood axis: positive is flood, negative is ebb.

### GET /currents/events

Get slack water, maximum flood, and maximum ebb for the nearest current station.

**Query Parameters:**

- `latitude` (required): Latitude (-90 to 90)
- `longitude` (required): Longitude (-180 to 180)
- `start` (optional): Start date/time in ISO 8601 format, defaults to now
- `end` (optional): End date/time in ISO 8601 format, defaults to 7 days after `start`. At most 366 days after `start`.

**Example:**

```bash
curl "http://localhost:3000/currents/events?latitude=48.406&longitude=-122.643&start=2026-06-01T00:00:00Z&end=2026-06-02T00:00:00Z"
```

```json
{
  "units": "knots",
  "floodDirection": 101.5,
  "ebbDirection": 281.5,
  "station": {
    "id": "noaa/PUG1701",
    "name": "Deception Pass (Narrows)",
    "bins": [{ "id": "noaa/PUG1701" }],
    "predictions": true
  },
  "distance": 0.02,
  "events": [
    { "time": "2026-06-01T00:04:37.920Z", "speed": 0.0002, "kind": "slack" },
    { "time": "2026-06-01T03:25:37.661Z", "speed": -5.17, "kind": "maxEbb", "direction": 281.5 }
  ]
}
```

`station` is the full station record, shortened here. `kind` is `slack`, `maxFlood`, or `maxEbb`. `direction` is in degrees true and is absent for slack, and for stations that don't publish that direction. `distance` is in kilometers.

### GET /currents/timeline

Get signed current speed every 10 minutes for the nearest current station. Returns `timeline: [{ time, hour, speed }]` in place of `events`. A subordinate station's timeline is a curve drawn through its predicted events, not a harmonic sum.

**Query Parameters:** Same as `/currents/events`

### GET /currents/stations

Search current stations, find them near a location, or list all of them. Takes the same query parameters as `/tides/stations`.

Each station appears once, at its primary bin. As with `/tides/stations`, a location search returns full station records with `distance` and the other modes return summaries. Every mode includes stations whose predictions can't be served. Every current station also carries:

- `bins`: each depth bin of the station, primary first, e.g. `[{ "id": "noaa/EPT0003" }, { "id": "noaa/EPT0003@11", "bin": 11 }]`
- `predictions`: whether this API can serve predictions for the station
- `unavailable`: why not, when `predictions` is `false`
- `attribution` and `license`, as on `/tides/stations`

### GET /currents/stations/:source/:id

Get a current station by ID. An ID with no bin is the station's primary bin, the one NOAA predicts by default. Append `@N` to select bin N:

```bash
curl "http://localhost:3000/currents/stations/noaa/EPT0003"     # primary bin
curl "http://localhost:3000/currents/stations/noaa/EPT0003@11"  # bin 11
```

An unknown bin returns 404 with the bins that exist. Keep the slash between source and ID literal: `noaa%2FEPT0003` is not found. IDs without a source prefix, such as `chs-active-pass`, are a single path segment: `/currents/stations/chs-active-pass`.

### GET /currents/stations/:source/:id/events

### GET /currents/stations/:source/:id/timeline

Get events or a timeline for a specific station and bin. They take `start` and `end`.

Canadian Hydrographic Service stations are listed so clients can show them, but CHS terms don't allow its predictions to be redistributed. Their prediction endpoints return **451** with a link to the official CHS predictions. `/currents/events` and `/currents/timeline` use the nearest station even when it is a CHS station, and return its 451 instead of answering for a station farther away. They skip stations with no model. A station with no harmonic constituents or subordinate offsets returns **404**.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npx vitest

# Run tests with coverage
npx vitest run --coverage
```

## License

MIT
