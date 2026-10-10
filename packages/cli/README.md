# `slackwater` Command Line Interface

Command line interface for tide and current predictions. Search for stations, view high/low tides and water level timelines, and see when the current turns and how hard it runs, from your terminal.

## Install

### Homebrew (Apple Silicon macOS / x86_64 Linux)

```sh
brew install openwatersio/tap/slackwater
```

### Shell script (Apple Silicon macOS / x86_64 Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/openwatersio/slackwater/main/install.sh | sh
```

### npm

```sh
npm install -g @slackwater/cli
```

### Download binary

Pre-built binaries for macOS (Apple Silicon), Linux (x86_64), and Windows (x64) are available on the [GitHub Releases](https://github.com/openwatersio/slackwater/releases) page.

## Usage

### Find stations

Search for tide prediction stations by name, region, or country:

```sh
slackwater stations "san francisco"
```

Find stations near a location:

```sh
slackwater stations --near 37.8,-122.5
```

Combine search with proximity:

```sh
slackwater stations "portland" --near 45.5,-122.7
```

Options:

| Flag                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `-n, --near <lat,lon>`  | Find stations near coordinates             |
| `--ip`                  | Use IP geolocation to find nearby stations |
| `-l, --limit <n>`       | Maximum results (default: 10)              |
| `-a, --all`             | Show all matching stations (no limit)      |
| `-f, --format <format>` | Output format: `text`, `json`              |

### Tide extremes (high/low)

Get predicted high and low tides for a station:

```sh
slackwater extremes --station noaa/9414290
```

Use your current location:

```sh
slackwater extremes --ip
```

Options:

| Flag                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `-s, --station <id>`    | Station ID                                 |
| `-n, --near <lat,lon>`  | Find nearest station to coordinates        |
| `--ip`                  | Use IP geolocation to find nearest station |
| `--start <date>`        | Start date in ISO format (default: now)    |
| `--end <date>`          | End date (default: 72h from start)         |
| `-u, --units <units>`   | `meters` or `feet` (default: meters)       |
| `-f, --format <format>` | Output format: `text`, `json`              |

### Water level timeline

Get a water level timeline with an ASCII chart:

```sh
slackwater timeline --station noaa/9414290
```

Specify a date range and interval:

```sh
slackwater timeline --station noaa/9414290 --start 2026-01-01 --end 2026-01-02 --interval 30
```

Options:

| Flag                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `-s, --station <id>`    | Station ID                                 |
| `-n, --near <lat,lon>`  | Find nearest station to coordinates        |
| `--ip`                  | Use IP geolocation to find nearest station |
| `--start <date>`        | Start date in ISO format (default: now)    |
| `--end <date>`          | End date (default: 24h from start)         |
| `-u, --units <units>`   | `meters` or `feet` (default: meters)       |
| `--interval <minutes>`  | Minutes between data points (default: 60)  |
| `-f, --format <format>` | Output format: `text`, `json`              |

### Tidal currents

Current commands live under `slackwater currents`. Speeds are in knots along the station's flood axis: in JSON, positive is flood and negative is ebb. Directions are in degrees true. Times are shown in the station's time zone.

Get slack water, maximum flood, and maximum ebb (the default subcommand, so `slackwater currents` and `slackwater currents events` are the same):

```sh
slackwater currents --near 48.406,-122.643
```

```
Deception Pass (Narrows)
noaa/PUG1701  ·  knots  ·  flood 102°T  ·  ebb 282°T  ·  0.0 km away

┌──────────────┬──────────────┬───────────┬────────┬───────────┐
│ Date         │ Time         │ Event     │ Speed  │ Direction │
├──────────────┼──────────────┼───────────┼────────┼───────────┤
│ Jun 1, 2026  │ 1:25 AM PDT  │ Max flood │ 4.0 kn │     102°T │
├──────────────┼──────────────┼───────────┼────────┼───────────┤
│              │ 4:13 AM PDT  │ Slack     │        │           │
├──────────────┼──────────────┼───────────┼────────┼───────────┤
│              │ 7:07 AM PDT  │ Max ebb   │ 7.1 kn │     282°T │
└──────────────┴──────────────┴───────────┴────────┴───────────┘
```

Get a timeline of current speed:

```sh
slackwater currents timeline --station noaa/PUG1701 --interval 30
```

Get slack water windows, the stretches around each turn when the current runs below a speed you choose (0.5 knots by default). A window that runs past the start or end of the period shows its duration as `≥`, a lower bound:

```sh
slackwater currents slack --station noaa/PUG1701 --threshold 1
```

Search for current stations by name, or find them near a location:

```sh
slackwater currents stations "deception"
slackwater currents stations --near 48.4,-122.6
```

`currents stations` takes the same options as `stations`. Each station is listed once, with the number of depth bins it has and whether Slackwater can predict it.

#### Stations and depth bins

Some NOAA stations publish predictions for several depths. A station ID on its own is the station's primary bin, the one NOAA predicts by default. Append `@N` to pick bin N:

```sh
slackwater currents --station noaa/EPT0003     # primary bin
slackwater currents --station noaa/EPT0003@11  # bin 11
```

An unknown bin fails with the list of bins that exist.

Some stations can't be predicted. Canadian Hydrographic Service terms don't allow its predictions to be redistributed, so CHS stations are listed but the prediction commands point you to [tides.gc.ca](https://tides.gc.ca/en/tides-currents-and-water-levels) instead. A station with no harmonic constituents or reference station fails with that reason. `--near` skips stations with no model, but when the nearest station is a CHS station it fails rather than answering for a different channel farther away.

Options for `events`, `timeline`, and `slack`:

| Flag                      | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `-s, --station <id>`      | Station ID, with `@N` for depth bin N                                              |
| `-n, --near <lat,lon>`    | Find nearest current station to coordinates                                        |
| `--ip`                    | Use IP geolocation to find nearest current station                                 |
| `--start <date>`          | Start date in ISO format (default: now)                                            |
| `--end <date>`            | End date, at most 366 days from start (default: 24h for `timeline`, otherwise 72h) |
| `--interval <minutes>`    | `timeline` only: whole minutes between data points (default: 60)                   |
| `-t, --threshold <knots>` | `slack` only: speed the current must stay below (default: 0.5 kn)                  |
| `-f, --format <format>`   | Output format: `text`, `json`                                                      |

### API server

Start the Slackwater REST API server locally. It serves tides at `/extremes`, `/timeline`, and `/stations`, and currents at `/currents/events`, `/currents/timeline`, and `/currents/stations`:

```sh
slackwater serve
```

Specify a custom port:

```sh
slackwater serve --port 8080
```

Options:

| Flag             | Description                       |
| ---------------- | --------------------------------- |
| `-p, --port <n>` | Port to listen on (default: 3000) |

### JSON output

All commands support `--format json` for machine-readable output:

```sh
slackwater extremes --station noaa/9414290 --format json
slackwater timeline --station noaa/9414290 --format json
slackwater stations "seattle" --format json
slackwater currents --station noaa/PUG1701 --format json
```

JSON for `currents events` and `currents timeline` has the same shape as the matching [`@slackwater/api`](../api) current endpoints: `units`, `floodDirection` and `ebbDirection` when the station publishes them, the `station` record with its `bins` and `predictions` flags, `distance` in kilometers for `--near` and `--ip`, and then `events` or `timeline`. `currents slack` returns `threshold` and `windows: [{ start, end }]` in their place; a window cut off by the start or end of the period has `clipped: true`, and text output marks its duration with `≥`.

## License

MIT
