---
"@slackwater/api": minor
---

Serve tidal current predictions as a sibling route group at `/currents` (set with `createApp({ currentsPrefix })`, or mount `createCurrentRoutes()` yourself): `events` and `timeline` near a location, `stations` search, and per-station `events` and `timeline`, with their own OpenAPI document. `createRoutes()` and the tide routes are unchanged. Speeds are signed knots along the flood axis, and events are `slack`, `maxFlood`, or `maxEbb` with flood and ebb directions. A station ID with no bin is the primary bin and `@N` selects bin N (`noaa/EPT0003@11`). Listings show each station once with its `bins`. Canadian Hydrographic Service stations are listed but flagged, because CHS terms don't allow its predictions to be redistributed, and their prediction endpoints return 451. Prediction spans are limited to 366 days.

Station search by `query` now honors `maxResults` above 20, on both `/stations` and `/currents/stations`. `/extremes` and `/timeline` skip tide stations with no harmonic constituents or offsets (the CHS ports), which returned no extremes and a flat zero timeline.
