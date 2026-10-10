# @slackwater/api

HTTP API for tide predictions, built on [Slackwater](https://openwaters.io/tides/slackwater/). A hosted instance runs at [api.openwaters.io/tides](https://api.openwaters.io/tides/).

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

// Mount the API at a specific path
mainApp.use("/api", createApp());

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
