---
"slackwater": major
"@slackwater/api": major
---

Importing `slackwater` or `@slackwater/api` no longer reads the station database, which loads on first use. In `slackwater`, `findStation`, `nearestStation`, `stationsNear`, `findCurrentStation`, `nearestCurrentStation`, `currentStationsNear`, `currentStationUnavailable`, and the `get*Prediction` helpers now return promises, so add `await` to each call. `currentStationUnavailableIn(db, station)` is the synchronous form for filter callbacks, taking a database from `loadStations()`. In `@slackwater/api`, the `openapi` and `currentsOpenapi` exports are now `loadOpenapi()` and `loadCurrentsOpenapi()`, with `Openapi` and `CurrentsOpenapi` types. `createApp`, `createRoutes`, and `createCurrentRoutes` are unchanged.
