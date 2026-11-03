---
"@slackwater/api": minor
---

Tide station listings and lookups say whether the API can predict each station, with `predictions` and, when it can't, an `unavailable` reason, as the current routes do. Tide listings exclude stations without a prediction model. Direct lookups of Canadian Hydrographic Service ports carry `predictions: false`, and `/tides/stations/:id` serves their unprefixed records, such as `chs-campbell-river`.
