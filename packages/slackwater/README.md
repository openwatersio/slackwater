# slackwater

Tide and current predictions for anywhere in the world, with the station database built in. Give it a position or a station ID and it finds the station and runs the prediction.

`slackwater` is the batteries-included entry point to the Slackwater engine. It bundles [`@slackwater/engine`](https://www.npmjs.com/package/@slackwater/engine), the harmonic engine, with [`@slackwater/database`](https://github.com/openwatersio/slackwater-database), the station database.

> [!WARNING]
> **Not for navigational use.** Do not use these predictions for navigation, or depend on them in any situation where inaccuracies could result in harm to a person or property.

## Install

```sh
npm install slackwater
```

## Usage

```typescript
import { getExtremesPrediction } from "slackwater";

const prediction = await getExtremesPrediction({
  lat: 37.8,
  lon: -122.5,
  start: new Date("2025-12-17"),
  end: new Date("2025-12-18"),
  units: "feet", // optional, defaults to 'meters'
});

console.log(prediction.station.name);
for (const { time, level, label } of prediction.extremes) {
  console.log(time.toISOString(), label, level.toFixed(2));
}
```

Every function that reads the station database returns a promise, and the database loads on the first call rather than on import.

### Currents

`getCurrentTimelinePrediction` returns signed major-axis `speed`, nonnegative `magnitude` in knots, and optional `direction` in degrees true. NOAA harmonic stations use both axes where the database supplies published minor-axis data, so direction can rotate through a major-axis slack while water keeps moving. Stations without effective minor data and subordinate stations use absolute speed and their published flood or ebb bearing. Zero vectors and unpublished bearings have no direction. For caller-supplied constants, use the [engine's vector predictor](../engine/README.md#current-prediction). Flood, ebb, and slack events use the major axis.

Current predictions are signed speeds in knots along the station's flood axis: positive is flood, negative is ebb, zero is slack.

```typescript
import { getCurrentEventsPrediction } from "slackwater";

const prediction = await getCurrentEventsPrediction({
  lat: 48.4,
  lon: -122.64,
  start: new Date("2025-12-17"),
  end: new Date("2025-12-18"),
});

console.log(prediction.station.name);
for (const { time, kind, speed } of prediction.events) {
  console.log(time.toISOString(), kind, speed.toFixed(2));
}
```

The package also gets water level timelines (`getTimelinePrediction`), the level at one moment (`getWaterLevelAtTime`), station lookup (`nearestStation`, `stationsNear`, `findStation`), current speed timelines (`getCurrentTimelinePrediction`), slack windows (`slackWindows`), and current station lookup (`nearestCurrentStation`, `currentStationsNear`, `findCurrentStation`). The [repository README](https://github.com/openwatersio/slackwater#readme) covers each one with examples. If the database marks a tide record redundant, `findStation` resolves its ID to an accepted replacement with a tide model. A commercially usable record never automatically resolves to a noncommercial replacement; direct lookups of noncommercial records remain available.

## Documentation

Full documentation lives at [openwaters.io/tides/slackwater](https://openwaters.io/tides/slackwater/).

## The Slackwater family

- [Slackwater for iPhone](https://slackwater.xyz): the app
- [`@slackwater/engine`](https://www.npmjs.com/package/@slackwater/engine) and [SlackwaterKit](https://github.com/openwatersio/slackwater/tree/main/swift): the engine for TypeScript and Swift
- [`@slackwater/cli`](https://www.npmjs.com/package/@slackwater/cli): the command line tool, also `brew install openwatersio/tap/slackwater`
- [`@slackwater/api`](https://www.npmjs.com/package/@slackwater/api): the HTTP API, hosted at [api.openwaters.io/tides](https://api.openwaters.io/tides/)
- [`@slackwater/react`](https://www.npmjs.com/package/@slackwater/react): React components
- [`@slackwater/database`](https://github.com/openwatersio/slackwater-database): the station database

## License

MIT. Station data carries its own license per station; see the [database README](https://github.com/openwatersio/slackwater-database#license). Most stations require credit, so include `station.attribution` wherever you show a station's data. Some stations are not licensed for commercial use; they have `station.license.commercial_use` set to `false`.
