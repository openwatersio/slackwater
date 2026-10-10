---
"@slackwater/engine": minor
"slackwater": minor
---

Add tidal current prediction: harmonic current stations (`createCurrentPredictor`, `useCurrentStation`), NOAA subordinate reductions (`createSubordinateCurrentPredictor`), slack/max flood/max ebb events, signed speed timelines in knots, and the `slackWindows` helper. The `slackwater` package gains `getCurrentEventsPrediction`, `getCurrentTimelinePrediction`, `nearestCurrentStation`, `currentStationsNear`, `findCurrentStation`, `currentStationUnavailable`, and `parseCurrentBin`. Location lookups skip secondary depth bins and stations that can't be predicted, such as Canadian Hydrographic Service stations. Flood and ebb directions are optional, and events leave out a direction the station doesn't publish.
