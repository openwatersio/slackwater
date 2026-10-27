# Contributing to Slackwater

Contributing guidelines for humans and AI agents.

## Project Overview

Slackwater is a TypeScript tide and current prediction engine split into multiple `packages/*` in a monorepo:

1. **`@slackwater/engine`** - Core harmonic calculation engine (astronomy coefficients, tidal constituents, node corrections)
2. **`slackwater`** - User-facing API that wraps the predictor and integrates with `@slackwater/database` for station lookups
3. **`@slackwater/api`** - HTTP JSON API server built with Express, provides REST endpoints for tide and tidal current predictions with OpenAPI validation
4. **`@slackwater/cli`** - Command line interface built with Commander, distributed as npm package, Homebrew formula, and standalone SEA binaries

## Critical Architecture Patterns

### Station Resolution & Data Flow

The `slackwater` package acts as a coordinator between the external `@slackwater/database` (station data) and `@slackwater/engine` (calculations). Key flow:

```typescript
// User provides lat/lon → find nearest station → extract constituents → run predictor
nearestStation(position) → station.harmonic_constituents → createTidePredictor(constituents)
```

For **subordinate stations** (lack their own harmonic data), the code automatically resolves to their reference station via `station.offsets?.reference`. See [packages/slackwater/src/index.ts](packages/slackwater/src/index.ts).

### Tidal Constituent & Node Correction System

The predictor uses the harmonic constituents defined in [data.json](packages/engine/src/constituents/data.json), derived from the [IHO TWCWG standard](docs/TWCWG_Constituent_list.md). Two node correction formula sets are supported: **IHO** (default, simplified Fourier series) and **Schureman** (legacy, exact spherical geometry), selectable via options:

```typescript
createTidePredictor(constituents, { nodeCorrections: "iho" }); // default
createTidePredictor(constituents, { nodeCorrections: "schureman" });
```

For detailed internals (XDO conversion, letter code dispatch, compound decomposition), see [packages/engine/README.md](packages/engine/README.md#architecture-internals).

### Current Stations

Tidal currents reuse the harmonic machinery with the result read as signed velocity in knots along the flood axis. `createCurrentPredictor` produces timelines and slack/max flood/max ebb events (extracted per UTC day so results never depend on the requested window); `createSubordinateCurrentPredictor` applies NOAA's two-slack offset reduction against a reference predictor, with offset times in seconds at the engine level. `useCurrentStation` consumes `@slackwater/database` stations with `kind === "current"`, converting the database's offset minutes and predicting harmonically whenever a station carries its own constituents. Flood and ebb directions are optional throughout; an event for a phase without a published direction has no `direction`. The `slackwater` package resolves a subordinate's `current.offsets.reference` id automatically. Its location lookups skip secondary depth bins (`@N` ids) and stations `currentStationUnavailable` refuses (CHS stations, matched by `source.name`, and stations with no model); `findCurrentStation` still finds them by id, and their prediction methods throw the reason. Validation runs against NOAA's own predictions via the `fixtures/currents-golden-*.json` fixtures at the tolerances in [docs/CONTRACT.md](docs/CONTRACT.md); `fixtures/generate/gen-currents.mjs` generates the TS-side parity fixture checked by `npm run fixtures:check`.

### @slackwater/api Architecture

The API package (`packages/api`) exposes tide and tidal current predictions via Express HTTP endpoints. Key design patterns:

- **Routes** (`src/routes.ts`) - Handles Express request/response for all endpoints
- **OpenAPI specification** (`src/openapi.ts`) - Full 3.0.3 schema with validation middleware
- **Request validation** - Uses `express-openapi-validator` to enforce OpenAPI schema for all requests/responses
- **Wrapper integration** - Calls `slackwater` package functions (`getExtremesPrediction`, `getTimelinePrediction`, `findStation`, `stationsNear`, and `findCurrentStation`, `parseCurrentBin`, `currentStationUnavailable` for currents) to perform predictions

**Endpoints:**

- `GET /` - API information (name, version, docs link)
- `GET /openapi.json` - Returns OpenAPI specification
- `GET /extremes` - Get high/low tide predictions near coordinates
- `GET /timeline` - Get water levels at regular intervals near coordinates
- `GET /stations` - Search stations by query, find by proximity, or list all
- `GET /stations/:source/:id` - Get a specific station by source and ID
- `GET /stations/:source/:id/extremes` - Get extremes for a specific station
- `GET /stations/:source/:id/timeline` - Get timeline for a specific station

**Current endpoints** (a sibling route group, `/currents` by default):

- `GET /currents/events`, `GET /currents/timeline` - Current events (slack, max flood, max ebb) or signed speed timeline near coordinates
- `GET /currents/stations`, `GET /currents/stations/:source/:id[/events|/timeline]` - Current station lookup and per-station predictions

Current routes live in `src/currents.ts` with their own spec (`currentsOpenapi` in `src/openapi.ts`, sharing the tide spec's parameters and schemas). `src/router.ts` gives both route groups the same JSON parsing, `/` and `/openapi.json` routes, and error handler. A station ID without a bin is the station's primary bin; `@N` selects bin N (`noaa/EPT0003@11`). Listings show each station once with its `bins`. Bin parsing and the rule for which stations can be served come from `slackwater` (`parseCurrentBin`, `currentStationUnavailable`). Stations whose predictions can't be served (CHS, whose terms forbid redistribution, and records with no model) are flagged `predictions: false` in every listing mode and refused by the prediction endpoints (451 for CHS, 404 for no model). The location endpoints look up stations through `@slackwater/database` directly rather than `nearestCurrentStation`: they skip stations with no model, but a CHS station that is nearest still decides and is refused with 451, so they never answer for a different channel farther away. The curated CHS and Boundary Pass records have no source prefix, so single-segment `/currents/stations/:id` routes serve them. The tide `/extremes` and `/timeline` likewise skip tide stations with no harmonic constituents or offsets, which covers the CHS ports.

**Prefix mounting:** `createApp` mounts the tide routes at `prefix` (default: `/tides`) and the current routes at `currentsPrefix` (default: `/currents`). Each group's OpenAPI document sets `servers` to wherever it is mounted.

**Bounding-box listings:** Both station route groups use `stationsInBounds` in `packages/api/src/bbox.ts`. A validated box whose west longitude exceeds its east longitude crosses the dateline; the helper queries each side separately because the database's spatial index requires ordered longitude bounds. Both queries retain the route's station filter, including the current primary-bin rule. This does not change harmonic predictions or the database itself.

```typescript
// Standalone server with default /tides prefix
import { createApp } from "@slackwater/api";
const app = createApp(); // /tides/extremes, /tides/stations, ... and /currents/events, ...
app.listen(3000);

// Mount at root
const app = createApp({ prefix: "/" }); // /extremes, /stations, ... and /currents/events, ...

// Mount routes into an existing Express app
import { createRoutes, createCurrentRoutes } from "@slackwater/api";
import express from "express";
const app = express();
app.use("/api/tides", createRoutes());
app.use("/api/currents", createCurrentRoutes());
```

### @slackwater/cli Architecture

The CLI package (`packages/cli`) provides a terminal interface for tide and current predictions. Key design patterns:

- **Commander** for command parsing with `exitOverride()` for testability
- **Formatters** (`src/formatters/`) - Pluggable output formatters (`text`, `json`) with an ASCII chart for timeline
- **Station resolution** (`src/lib/station.ts`) - Shared logic for `--station`, `--near`, and `--ip` options across commands
- **SEA binaries** - Built via `scripts/build-sea.ts` using Node.js Single Executable Applications for standalone distribution. The station database is embedded as an SEA asset, because `@slackwater/database` normally reads it from disk, and its attribution ships as `NOTICE` in each release archive. `npm run smoke:sea` runs the built binary, and CI runs it before any binary is uploaded.

- **Current stations** (`src/lib/currents.ts`) - Resolves `--station` (with `@N` bins), `--near`, and `--ip` for the `currents` subcommands and shapes their output like the `@slackwater/api` current endpoints. `--near` follows the API's rule: it skips stations with no model, but a nearest CHS station is refused rather than replaced by one farther away.

**Commands:** `extremes`, `timeline`, `stations`, `currents` (`events` by default, `timeline`, `slack`, `stations`), `serve`

**Distribution:** npm (`@slackwater/cli`), Homebrew (`openwatersio/tap/slackwater`), shell installer (`install.sh`), and pre-built binaries on GitHub Releases. The Homebrew formula (`packages/cli/homebrew/slackwater.rb`) installs the npm package on Homebrew's `node`, so the release workflow renders it from the published npm tarball rather than the SEA binaries. The SEA binaries serve the shell installer and the Releases page; `install.sh` runs the binary before installing it so a missing system library fails with instructions.

**Testing:** Uses `vitest` with a `run()` helper (`test/helpers.ts`) that invokes the CLI programmatically via Commander's `parseAsync`. The serve command exports a `stop()` function for test cleanup.

## Development Workflows

### Build & Test

```bash
npm run build              # Builds all workspace packages (uses tsdown/tsc)
npm test -- --run          # Runs vitest across all packages
npm run coverage           # Generates coverage report to coverage/
npm run lint               # ESLint + Prettier check
npm run format             # Auto-format with Prettier
```

Tests are split per-package in `packages/*/test/`. The root `vitest.config.ts` uses projects to run all workspace tests together.

### Package Publishing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. Each package has a `prepack` script that runs its build before `npm publish` using `tsdown`.

Release automation uses Changesets CLI v3 and `changesets/action` v2. Run `npm run test:release` to check versioning, lockfile updates, beta and stable tags, and sequential publishing without publishing to npm. Versioned prerelease changesets live in `.changeset/pre/`; pending changesets stay in `.changeset/` until the next version step.

### Release Notes

Each changeset summary becomes a line in the release notes, so write it for the people using Slackwater: say what changed for them, not how it was implemented, and keep to one change per changeset. Follow the org guidance on [release titles and notes](https://github.com/openwatersio/.github/blob/main/docs/agents/releases.md#release-notes).

After the release workflow publishes, give the release for the umbrella `slackwater` package a headline that says what changed, in sentence case with no version and no closing period: `gh release edit slackwater@<version> --repo openwatersio/slackwater --title "<headline>"`. The [openwaters.io/updates](https://openwaters.io/updates/) page groups one publish run into one entry titled from that release.

### Import Conventions

**Always use `.js` extensions** in TypeScript imports:

```typescript
import harmonics from "./harmonics/index.js"; // correct
import harmonics from "./harmonics/index"; // will break
```

This is required for ESM compatibility (see `tsconfig.json` with `moduleResolution: "bundler"`).

## Testing Patterns

Swift CI uses the compiler provided by its Linux or macOS runner; the root mise configuration pins Node. Follow the shared [Swift toolchain guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/swift.md) when selecting a local compiler, adding a Swift mise pin, changing runner images or validating an installer. The Swift test commands and cross-port requirements below remain this repository’s contract.

The Swift engine is in `swift/Sources/SlackwaterKit`; run `swift test -c release` for its golden and prediction tests. Harmonic fitting evaluates per-sample astronomy and uses Accelerate QR least squares on Apple platforms. `@slackwater/engine` exports the corresponding TypeScript `fit(samples, names)` using bounded-batch QR alongside prediction. Both consume `fixtures/harmonic-fit-parity.json` and `fixtures/harmonic-fit-invalid.json`; update and run both suites when changing their contract. Every client fits a CHS tide port with the same recipe, `chsTideFit` in TypeScript and `ChsTideFit` in Swift and Kotlin, all three checked against `fixtures/chs-tide-fit.json`. `benchmarks/chs-fit.ts` validates the recipe on held-out CHS predictions against the bar in [docs/validation/chs-tides.md](docs/validation/chs-tides.md). CHS current gates use `chsCurrentFit` and `projectChsCurrent` (`ChsCurrentFit` in Swift and Kotlin), checked against `fixtures/chs-current-fit.json` and identified by a stamp that `fixtures/generate/gen-chs-current-golden.mjs` derives from the recipe and what it predicts for a fixed synthetic gate (`fixtures/chs-current-golden.json`). The stamp changes in all three engines when a change moves the golden gate's predicted velocity by 1e-4 kn or more, a slack or peak by 30 seconds or more, or a peak's speed by 0.001 kn or more. `benchmarks/chs-current-fit.ts` scores the recipe on a year-round grid of held-out weeks (`npm run chs-current-fit`) and writes rows. The benchmarks workflow runs it quickly on branch pushes; run it locally to score every gate and held-out week. [openwatersio/chs-current-validation](https://github.com/openwatersio/chs-current-validation) runs it in full every month for each recipe stamp its `targets.json` names, pools a year of rows per gate against the bar in [docs/validation/chs-currents.md](docs/validation/chs-currents.md), and publishes each gate's tier and bounds in its [releases](https://github.com/openwatersio/chs-current-validation/releases). A change to either recipe lands here with a benchmark run, never in a client. `SlackwaterIWLS` is a separate MIT Swift product for device-side IWLS fetching, with no dependency on `SlackwaterKit`. Its parsing and fetching rules are maintained in [docs/iwls-fetch.md](docs/iwls-fetch.md) and checked against synthetic `fixtures/iwls-fetch.json`; run `swift test -c release --filter SlackwaterIWLSTests`. `benchmarks/iwls.ts` implements the same contract in TypeScript for the benchmarks, and `npx vitest run --project benchmarks` checks it against the same fixture. It stays unpublished. Keep networking out of the prediction engines and CHS predictions out of API/CLI serving paths.

The Kotlin/JVM engine lives in `kotlin/`, targets JVM 8 bytecode with `java.time.Instant` (Android minSdk 26), and accepts constants directly. It uses IHO corrections and has no runtime I/O or station database. The `kotlin/iwls` subproject (`io.openwaters:slackwater-iwls`) is the only Kotlin code that does network I/O: the IWLS fetching contract for Android, checked against `fixtures/iwls-fetch.json` with the same 100% line coverage. Run `cd kotlin && ./gradlew test jacocoTestReport jacocoTestCoverageVerification` and `./gradlew -p smoke run` with JDK 17. JaCoCo enforces 100% handwritten line coverage, excluding the generated catalog. `fixtures/generate/gen-catalog.mjs` emits both Swift JSON and Kotlin literals; `npm run fixtures:check` validates the generator and checks both outputs. Kotlin-only changes run the Kotlin CI lane without npm publication. Shared fixtures and engine changes select both Swift and Kotlin as well as TypeScript. Source consumer setup and limitations are in [kotlin/README.md](kotlin/README.md).

Uses **Vitest** with `describe`/`test`.

## Code Style & Conventions

- **Strict TypeScript**: All type inference, no `any` usage
- **ESM-first**: `type: "module"` in all package.json files
- **Functional style**: Avoid classes
- **Datum handling**: MLLW is default when available; support feet/meters via conversion factor `3.2808399`
- **Date handling**: All times use UTC internally; users specify timezone offsets in Date constructors
- **100% test coverage** required for all new features and bug fixes. If it can't be tested, it shouldn't be in the code.

- **Type exports**: Export types alongside implementations (e.g. `export type { HarmonicConstituent }`)

For background on tidal harmonic prediction concepts (constituents, node corrections, compound decomposition), see the [IHO TWCWG standard](docs/TWCWG_Constituent_list.md) and the [engine README](packages/engine/README.md#architecture-internals).

## When Adding Features

- Always add corresponding tests and verify with `npm run coverage`. **100% test coverage is required** for pull requests to be merged.
- Update this CONTRIBUTING.md document with any relevant architectural notes or patterns related to the new feature.
- Ensure the `README.md` files in the relevant packages are updated with usage instructions and examples for the new feature.
- Use `npm run changeset` to create a changeset for the new feature, which feeds versioning and the release notes (see [Release Notes](#release-notes)).
