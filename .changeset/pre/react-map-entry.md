---
"@slackwater/react": major
---

Import `StationsMap` and `StationsMapProps` from `@slackwater/react/map`. The root entry no longer exports them, so it no longer imports `react-map-gl` or MapLibre's stylesheet up front. Station pages and `<NearbyStations>` load the map, its stylesheet and MapLibre only when they draw it, from a chunk your bundler still emits.

Breaking change: replace `import { StationsMap } from "@slackwater/react"` with `import { StationsMap } from "@slackwater/react/map"`.
