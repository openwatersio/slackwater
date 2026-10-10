# `slackwater` Command Line Interface

Command line interface for tide predictions. Search for stations, view high/low tides, and generate water level timelines from your terminal.

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

### API server

Start the Slackwater REST API server locally:

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
```

## License

MIT
