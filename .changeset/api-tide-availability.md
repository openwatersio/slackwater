---
"@slackwater/api": minor
---

Tide station listings and lookups say whether the API can predict each station, with `predictions` and, when it can't, an `unavailable` reason, as the current routes do. The Canadian Hydrographic Service ports are listed with `predictions: false`, and `/tides/stations/:id` serves their unprefixed records, such as `chs-campbell-river`.
