![example workflow](https://github.com/openwatersio/slackwater/actions/workflows/test.yml/badge.svg) [![codecov](https://codecov.io/gh/openwatersio/slackwater/branch/main/graph/badge.svg?token=KEJK5NQR5H)](https://codecov.io/gh/openwatersio/slackwater)

# Slackwater

A tide and current prediction engine for TypeScript and Swift.

> [!WARNING]
> **Not for navigational use**
>
> Do not use calculations from this project for navigation, or depend on them in any situation where inaccuracies could result in harm to a person or property. Tide predictions are only as good as the harmonics data available, and these can be inconsistent and vary widely based on the accuracy of the source data and local conditions. The tide predictions do not factor events such as storm surge, wind waves, uplift, tsunamis, or sadly, climate change. 😢

## Packages

This monorepo contains:

- **[slackwater](packages/slackwater)** - Main tide prediction library with station finding
- **[@slackwater/cli](packages/cli)** - Command line interface for tide predictions
- **[@slackwater/api](packages/api)** - HTTP JSON API for tide predictions with OpenAPI specification
- **[@slackwater/engine](packages/engine)** - Core harmonic tide prediction and fitting engine
- **[Slackwater for Swift](swift)** - Harmonic tide and current engine for SwiftPM

## Installation

### CLI

Install the command line tool to get tide predictions from your terminal:

```sh
brew install openwatersio/tap/slackwater
```

```sh
slackwater help                             # Show help and available commands
slackwater extremes --near 37.8,-122.5      # High/low tides near San Francisco
slackwater timeline --station noaa/9414290  # Water level timeline
slackwater stations "portland"              # Search for stations
slackwater serve                            # Start the REST API server
```

See the [CLI README](packages/cli) for full usage and installation options.

### Library

```sh
npm install slackwater
```

## Usage

### Tide Extremes Prediction

```typescript
import { getExtremesPrediction } from "slackwater";

const prediction = getExtremesPrediction({
  latitude: 26.7, // or `lat`
  longitude: -80.05, // or `lng` or `lon`
  start: new Date("2025-12-17"),
  end: new Date("2025-12-18"),
  datum: "MLLW", // optional, defaults to station's chart datum (usually LAT or MLLW)
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(prediction);
// {
//   datum: 'MLLW',
//   units: 'meters',
//   station: {
//     id: '8723214',
//     name: 'Fort Lauderdale, FL',
//     // ...
//   },
//   distance: 12.3,
//   extremes: [
//     { time: 2019-01-01T03:12:00.000Z, level: 3.2, high: true, low: false, label: 'High' },
//     { time: 2019-01-01T09:45:00.000Z, level: 0.5, high: false, low: true, label: 'Low' },
//   ]
// }
```

### Get Timeline Prediction

```typescript
import { getTimelinePrediction } from "slackwater";

const timeline = getTimelinePrediction({
  lat: 26.77,
  lon: -80.05,
  start: new Date("2025-12-19T00:00:00-05:00"),
  end: new Date("2025-12-19T01:00:00-05:00"),
  timeFidelity: 5 * 60, // seconds, defaults to `10 * 60`
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(timeline);
// {
//   datum: 'MLLW',
//   units: 'meters',
//   station: {
//     id: 'noaa/8722588',
//     name: 'Port of Palm Beach',
//     // ...
//   },
//   timeline: [
//     { time: 2025-12-19T05:00:00.000Z, hour: 0, level: 0.7232836255650095 },
//     { time: 2025-12-19T05:06:00.000Z, hour: 0.1, level: 0.7231644154595303 },
//     { time: 2025-12-19T05:12:00.000Z, hour: 0.2, level: 0.7221097788490487 },
//     { time: 2025-12-19T05:18:00.000Z, hour: 0.3, level: 0.7201242512580206 },
//     // ...
//   ]
// }
```

### Get Water Level at Specific Time

```typescript
import { getWaterLevelAtTime } from "slackwater";

const prediction = getWaterLevelAtTime({
  lat: 26.77,
  lon: -80.05,
  time: new Date("2025-12-19T00:30:00-05:00"),
  datum: "MSL",
  units: "meters", // optional, defaults to 'meters', can also be 'feet'
});

console.log(prediction);
// {
//   datum: 'MSL',
//   units: 'meters',
//   station: {
//     id: 'noaa/8722588',
//     name: 'Port of Palm Beach',
//     // ...
//   },
//   time: 2025-12-19T05:30:00.000Z,
//   hour: 0,
//   level: -0.43840585181640557
// }
```

### Finding stations

Slackwater uses [@slackwater/database](https://github.com/openwatersio/slackwater-database) to find station data. You can find stations by location or ID.

#### Nearest Station

```typescript
import { nearestStation } from "slackwater";

const station = nearestStation({ lat: 26.7, lon: -80.05 });
console.log(`${station.name} (${station.source.id})`); // Fort Lauderdale, FL (8722588)
```

Once you've found a station, you can get predictions, timeline, or water level at a specific time for that station:

```typescript
// Get extremes prediction for the nearest station
station.getExtremesPrediction({
  start: new Date("2025-12-17"),
  end: new Date("2025-12-18"),
});

// Get timeline prediction for the nearest station
station.getTimelinePrediction({
  start: new Date("2025-12-19"),
  end: new Date("2025-12-20"),
});

// Get timeline prediction for the nearest station
station.getWaterLevelAt({ time: new Date("2025-12-19T00:30:00-00:00") });
```

#### List Nearby Stations

```typescript
import { stationsNear } from "slackwater";

stationsNear({ latitude: 45.6, longitude: -122.7 }, 5).forEach((s) => {
  console.log(`${s.name} (${s.source.id}) - ${(s.distance / 1000).toFixed(2)} km away`);
});
// Vancouver (9440083) - 3.49 km away
// Portland Morrison Street Bridge (9439221) - 10.24 km away
// KNAPP(THORNES)LNDG, WILLOW BAR (9440171) - 16.34 km away
// Rocky Point (9439189) - 16.93 km away
// WASHOUGAL, COLUMBIA RIVER (9440047) - 24.89 km away
```

#### Find station by ID

```typescript
import { findStation } from "slackwater";

// Find station by Slackwater ID
findStation("noaa/8443970"); // Boston

// Find station by source ID (e.g. NOAA)
findStation("9440083"); // Vancouver
```

### Current predictions

The database also carries tidal current stations. Current predictions are signed speeds in knots along the station's flood axis: positive is flood, negative is ebb, zero is slack.

```typescript
import { getCurrentEventsPrediction, getCurrentTimelinePrediction, slackWindows } from "slackwater";

const options = {
  latitude: 48.406, // Deception Pass, WA
  longitude: -122.643,
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-06-02T00:00:00Z"),
};

// Slack, max flood, and max ebb events in time order. Flood and ebb events
// carry the station's direction in degrees true.
const { station, events } = getCurrentEventsPrediction(options);
// { time: Date, speed: -5.2, kind: "maxEbb", direction: 281.5 }

// The signed speed curve, sampled every 10 minutes by default.
const { timeline } = getCurrentTimelinePrediction(options);

// The windows where |speed| stays under a threshold around a reversal.
const windows = slackWindows(timeline, 0.5);
// [{ start: Date, end: Date }, ...]
```

Current stations can also be found with `nearestCurrentStation`, `currentStationsNear`, and `findCurrentStation`, mirroring the tide station functions. Subordinate current stations (time offsets and speed ratios against a reference station) are resolved automatically.

## Accuracy & Validation

Slackwater is continuously validated against NOAA tidal predictions, comparing the **time** and **height** of predicted high and low tides for all NOAA tide stations.

### Methodology

- High/low predictions over a full year extracted from both NOAA and Slackwater for 3300+ NOAA reference and subordinate stations
- One-to-one event matching using a ±180-minute window
- Metrics computed per station and aggregated across all stations
- Evaluated automatically in CI on every change

### Results

As of Feb 2026:

- **Stations evaluated:** 3,370
- **High/low events compared:** 4,522,258
- **Median |Δt|:** 0.6 minutes
- **95% of stations** have median |Δt| < **4.3 minutes**
- **Median MAE:** 5 mm
- **95% of stations** have MAE < 17 mm

### Summary

Slackwater reproduces high and low tide timing with **sub-minute accuracy** and tide heights with **millimeter-level accuracy** compared to NOAA's tide predictions. Validation is automated and enforced in CI to prevent regressions as the model evolves.
