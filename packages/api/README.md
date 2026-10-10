# @slackwater/api

HTTP JSON API for tide and tidal current predictions using [slackwater](https://github.com/openwatersio/slackwater).

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
```

`createApp` mounts the tide routes at `prefix` (default `/tides`) and the current routes at `currentsPrefix` (default `/currents`):

```typescript
createApp({ prefix: "/", currentsPrefix: "/currents" }); // /extremes, /stations, ... and /currents/events, ...
```

### As routers

`createRoutes()` returns the tide routes and `createCurrentRoutes()` the current routes, each with its own `/` and `/openapi.json`. Mount them wherever you like:

```typescript
import { createRoutes, createCurrentRoutes } from "@slackwater/api";

app.use("/api/tides", createRoutes());
app.use("/api/currents", createCurrentRoutes());

mainApp.listen(3000, () => {
  console.log("Server listening on port 3000");
});
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

### GET /tides/stations/:id/extremes

Get extremes prediction for a specific station.

**Path Parameters:**

- `id` (required): Station ID (URL-encoded if contains special characters)

**Query Parameters:**

- `start` (required): Start date/time in ISO 8601 format
- `end` (required): End date/time in ISO 8601 format
- `datum` (optional): Vertical datum
- `units` (optional): Units for water levels

**Example:**

```bash
curl "http://localhost:3000/tides/stations/noaa%2F8722588/extremes?start=2025-12-17T00:00:00Z&end=2025-12-18T00:00:00Z"
```

### GET /tides/stations/:id/timeline

Get timeline prediction for a specific station.

**Parameters:** Same as `/stations/:id/extremes`

### GET /tides/openapi.json

Get the OpenAPI 3.0 specification for this API.

## Tidal Current Endpoints

Current predictions are a sibling route group, served at `/currents/...` next to `/tides/...`, with their own OpenAPI document at `/currents/openapi.json`. Speeds are signed knots along the station's flood axis: positive is flood, negative is ebb.

### GET /currents/events

Get slack water, maximum flood, and maximum ebb for the nearest current station that can be predicted.

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

Each station appears once, at its primary bin. As with `/tides/stations`, a location search returns full station records and the other modes return summaries. Every current station also carries:

- `bins`: each depth bin of the station, primary first, e.g. `[{ "id": "noaa/EPT0003" }, { "id": "noaa/EPT0003@11", "bin": 11 }]`
- `predictions`: whether this API can serve predictions for the station
- `unavailable`: why not, when `predictions` is `false`

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

Canadian Hydrographic Service stations are listed so clients can show them, but CHS terms don't allow its predictions to be redistributed. Their prediction endpoints return **451** with a link to the official CHS predictions, and `/currents/events` and `/currents/timeline` skip them when picking the nearest station. A station with no harmonic constituents or subordinate offsets returns **404**.

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
