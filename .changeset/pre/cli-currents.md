---
"@slackwater/cli": minor
---

Add tidal currents with `slackwater currents`. `currents` (or `currents events`) shows slack water, max flood, and max ebb with speed in knots and direction in degrees true; `currents timeline` shows speed over time; `currents slack --threshold <knots>` shows the windows around each turn when the current runs below that speed; and `currents stations` searches current stations by name or location. Pick a station with `--station`, `--near`, or `--ip`. A bare station ID is the primary depth bin and `@N` selects bin N (`noaa/EPT0003@11`); an unknown bin lists the bins that exist. Canadian Hydrographic Service stations, whose terms don't allow redistributing their predictions, and stations with no model fail with the reason. `--format json` for `currents events` and `currents timeline` returns the same shape as the matching `@slackwater/api` endpoints.

`stations --all` now lists every match with `--near` or a query, instead of stopping at 10 or 20, and `stations <query> --near` ranks every station matching the query by distance instead of only the top 20 text matches. `--limit` must be a positive whole number.
