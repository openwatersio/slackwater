# Contributing to Slackwater

Contributing guidelines for humans and AI agents.

## Project Overview

Slackwater is a TypeScript tide prediction engine split into multiple `packages/*` in a monorepo:

1. **`@slackwater/engine`** - Core harmonic calculation engine (astronomy coefficients, tidal constituents, node corrections)
2. **`slackwater`** - User-facing API that wraps the predictor and integrates with `@slackwater/database` for station lookups
3. **`@slackwater/api`** - HTTP JSON API server built with Express, provides REST endpoints for tide predictions with OpenAPI validation
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

The predictor uses 395 harmonic constituents defined in [data.json](packages/engine/src/constituents/data.json), derived from the [IHO TWCWG standard](docs/TWCWG_Constituent_list.md). Two node correction formula sets are supported: **IHO** (default, simplified Fourier series) and **Schureman** (legacy, exact spherical geometry), selectable via options:

```typescript
createTidePredictor(constituents, { nodeCorrections: "iho" }); // default
createTidePredictor(constituents, { nodeCorrections: "schureman" });
```

For detailed internals (XDO conversion, letter code dispatch, compound decomposition), see [packages/engine/README.md](packages/engine/README.md#architecture-internals).

### Current Stations

Tidal currents reuse the harmonic machinery with the result read as signed velocity in knots along the flood axis. `createCurrentPredictor` produces timelines and slack/max flood/max ebb events (extracted per UTC day so results never depend on the requested window); `createSubordinateCurrentPredictor` applies NOAA's two-slack offset reduction against a reference predictor, with offset times in seconds at the engine level. `useCurrentStation` consumes `@slackwater/database` stations with `kind === "current"`, converting the database's offset minutes and predicting harmonically whenever a station carries its own constituents. The `slackwater` package resolves a subordinate's `current.offsets.reference` id automatically. Validation runs against NOAA's own predictions via the `fixtures/currents-golden-*.json` fixtures at the tolerances in [docs/CONTRACT.md](docs/CONTRACT.md); `fixtures/generate/gen-currents.mjs` generates the TS-side parity fixture checked by `npm run fixtures:check`.

### @slackwater/api Architecture

The API package (`packages/api`) exposes tide predictions via Express HTTP endpoints. Key design patterns:

- **Routes** (`src/routes.ts`) - Handles Express request/response for all endpoints
- **OpenAPI specification** (`src/openapi.ts`) - Full 3.0.3 schema with validation middleware
- **Request validation** - Uses `express-openapi-validator` to enforce OpenAPI schema for all requests/responses
- **Wrapper integration** - Calls `slackwater` package functions (`getExtremesPrediction`, `getTimelinePrediction`, `findStation`, `stationsNear`) to perform predictions

**Endpoints:**

- `GET /` - API information (name, version, docs link)
- `GET /openapi.json` - Returns OpenAPI specification
- `GET /extremes` - Get high/low tide predictions near coordinates
- `GET /timeline` - Get water levels at regular intervals near coordinates
- `GET /stations` - Search stations by query, find by proximity, or list all
- `GET /stations/:source/:id` - Get a specific station by source and ID
- `GET /stations/:source/:id/extremes` - Get extremes for a specific station
- `GET /stations/:source/:id/timeline` - Get timeline for a specific station

**Prefix mounting:** `createApp` accepts a `prefix` option (default: `/tides`) that controls the URL path where routes are mounted. The OpenAPI spec and validator are automatically configured for the prefix.

```typescript
// Standalone server with default /tides prefix
import { createApp } from "@slackwater/api";
const app = createApp(); // routes at /tides/extremes, /tides/stations, etc.
app.listen(3000);

// Mount at root
const app = createApp({ prefix: "/" }); // routes at /extremes, /stations, etc.

// Mount routes into an existing Express app
import { createRoutes } from "@slackwater/api";
import express from "express";
const app = express();
app.use("/api", createRoutes({ prefix: "/api" }));
```

### @slackwater/cli Architecture

The CLI package (`packages/cli`) provides a terminal interface for tide predictions. Key design patterns:

- **Commander** for command parsing with `exitOverride()` for testability
- **Formatters** (`src/formatters/`) - Pluggable output formatters (`text`, `json`) with an ASCII chart for timeline
- **Station resolution** (`src/lib/station.ts`) - Shared logic for `--station`, `--near`, and `--ip` options across commands
- **SEA binaries** - Built via `scripts/build-sea.ts` using Node.js Single Executable Applications for standalone distribution

**Commands:** `extremes`, `timeline`, `stations`, `serve`

**Distribution:** npm (`@slackwater/cli`), Homebrew (`openwatersio/tap/slackwater`), shell installer (`install.sh`), and pre-built binaries on GitHub Releases.

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

### Import Conventions

**Always use `.js` extensions** in TypeScript imports:

```typescript
import harmonics from "./harmonics/index.js"; // correct
import harmonics from "./harmonics/index"; // will break
```

This is required for ESM compatibility (see `tsconfig.json` with `moduleResolution: "bundler"`).

## Testing Patterns

The Swift engine is in `swift/Sources/SlackwaterKit`; run `swift test -c release` for its golden and prediction tests. Harmonic fitting evaluates per-sample astronomy and uses Accelerate QR least squares on Apple platforms. `@slackwater/engine` exports the corresponding TypeScript `fit(samples, names)` using bounded-batch QR alongside prediction. Both consume `fixtures/harmonic-fit-parity.json` and `fixtures/harmonic-fit-invalid.json`; update and run both suites when changing their contract. Provider-specific bases, parsing, rounding, and held-out validation belong to consumers.

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
- Use `npm run changeset` to create a changeset for the new feature, which will help with versioning and release notes when publishing.
