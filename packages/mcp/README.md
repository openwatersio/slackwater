# @slackwater/mcp

Read-only tide and tidal current tools for MCP assistants. The server uses Slackwater's prediction engine and generated station assets. It supports stateless Streamable HTTP and local stdio, with no user accounts or authentication.

## Tools

| Tool                     | Result                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `find_stations`          | Up to ten tide or current stations by name or coordinates, with availability and depth bins                |
| `get_station`            | Exact station identity, timezone, source, license, datum choices, model/reference and optional diagnostics |
| `get_tide_prediction`    | High/low tide events and an optional ten-minute timeline, in meters or feet                                |
| `get_current_prediction` | Signed major-axis events in knots, with optional ten-minute magnitude/direction samples and offsets        |
| `get_slack_windows`      | Windows around predicted slack events at an explicit major-axis threshold                                  |

Use canonical station IDs such as `noaa/PCT1391`. An explicit `@N` suffix selects a current depth bin. A missing bin is an error; the tools never silently substitute another depth or station. Text search matches all words, ignoring accents and case, and ranks exact names and IDs first. Nearby search defaults to 50 nautical miles and accepts a radius greater than zero and at most 200 nautical miles.

Predictions require explicit RFC3339 `start` and `end` timestamps with offsets, with a positive interval of at most three days. Responses use UTC timestamps and include the station timezone for local rendering. Tide responses name their datum; `null` means no named datum was selected. Current speeds retain precision and are signed along the major axis: positive flood and negative ebb. Timeline `magnitude` and `direction`, when supplied, describe the full vector. Event kinds retain the engine's classification, including a near-zero non-reversing ebb labeled `maxEbb`.

Slack windows are anchored to the engine's slack events. A threshold of zero returns exact instants; non-reversing lulls are excluded. The tool predicts 24 hours of context on either side of the requested interval, clips returned windows to that interval, and marks clipped or series-limited boundaries. Associated slack times can lie outside the requested interval and are returned as context. These windows do not establish a full-vector minimum or passage safety.

Include the response's source attribution when displaying predictions. Models are predictions, not observations, and are not for navigation.

## Generate a catalog

Build from the repository root:

```sh
npm run build -w @slackwater/engine
npm run build -w slackwater
npm run build -w @slackwater/mcp
node packages/mcp/bin/generate-catalog.js packages/mcp/generated
```

The generator reads the pinned database release at build time. It emits metadata, a version stamp, and individually addressable permitted models. Commercial permission must be explicitly true for selected models and required references. CHS redistribution restrictions, rejected records, missing models and unavailable references are refused. Unavailable metadata remains discoverable without exposing forbidden harmonic inputs. Accepted tide replacements preserve commercial permission and return canonical metadata.

The manifest is replaced only after model files have been written into a content-addressed directory. Older generated directories remain available for in-flight readers; use a fresh output directory for a clean deployment artifact. Generated assets are not committed or included in the npm package. The Worker runtime imports no bundled database or fuzzy index.

## Local connection

Launch `slackwater-mcp` with the generated catalog directory as its only argument. For an MCP client configuration:

```json
{
  "mcpServers": {
    "slackwater": {
      "command": "slackwater-mcp",
      "args": ["/absolute/path/to/generated"]
    }
  }
}
```

The command writes only MCP protocol messages to stdout. Startup errors go to stderr. The Node generator and local adapter load files; they are separate from the Worker entry point.

## HTTP and Workers

`@slackwater/mcp/http` exports `handleRequest(catalog, request, options)`. `@slackwater/mcp/worker` exports a Worker using the `ASSETS` binding and an optional `RATE_LIMITER` binding. The example Wrangler configuration is a deployment template; it declares no public domain or account and does not configure a limiter namespace. Configure that binding before public deployment.

Only `/mcp` and a minimal `/health` endpoint are served. Direct requests for station assets return 404. Each HTTP request accepts one JSON-RPC message; batches are rejected before tool execution. HTTP requests are bounded to 16 KiB, including chunked requests without Content-Length. Complete JSON-RPC responses are bounded to 256 KiB, including structured data and the duplicated JSON text fallback. Oversized results return an explicit error; shorten the interval or omit diagnostics. Tool handlers reserve space for the request ID and envelope, so a result can be refused before reaching the absolute ceiling.

The optional limiter returns 429 and `Retry-After: 60` when exhausted. A deployment can start with 120 requests per 60 seconds per caller IP. The example 100 ms CPU limit is provisional: validate cold manifest loading and concurrent three-day diagnostics on the deployed Worker before opening public access. The full manifest retains per-station source and license metadata, so startup cost must be measured with the real catalog. Cloudflare rate limits are regional and approximate; shared assistant egress can share a bucket. The library does not implement a global user quota. Worker logs contain tool name, HTTP status, duration and server version; they omit tool arguments and prediction bodies. Hosting platform access logs and retention require a separate deployment privacy policy.

For a custom host, import `Catalog` and `createServer` from `@slackwater/mcp` and supply a catalog generated by `@slackwater/mcp/generate`. The transport and engine use the same catalog version stamp. Publish registry metadata only after confirming the deployed server reports its intended version.

## Diagnostic example

Call `find_stations` with `{ "kind": "current", "query": "Trial Island" }`, then call:

```json
{
  "station_id": "noaa/PCT1391",
  "start": "2026-11-10T08:00:00Z",
  "end": "2026-11-11T08:00:00Z",
  "diagnostics": true
}
```

This `get_current_prediction` request returns raw event values, the reference identity, offsets, samples and engine/database versions. Preserve those fields when reporting a suspected display or classification issue.

## Verification

```sh
npx vitest run --project mcp
npx vitest run --project mcp --coverage
npm run build -w @slackwater/mcp
```

Tests cover permission and replacement paths, bins, station search, datum and offset behavior, slack windows, raw Trial Island events, vector samples, output bounds, stateless discovery, CORS, unavailable data and the asset/file adapters. Production deployment, registry publication and marketplace approval are separate release steps.
