---
"slackwater": patch
"@slackwater/api": patch
---

`nearestStation`, `stationsNear`, and the predictions that use them skip tide stations with no model, such as CHS ports, instead of returning a flat zero tide. `findStation` still finds them by id. The `/tides/stations` listing by coordinates no longer includes them.
