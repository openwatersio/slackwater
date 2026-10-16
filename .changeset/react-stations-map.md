---
"@slackwater/react": major
---

`StationsMap` is the Slackwater app's stations map. It shows tide and current stations together as live pins on OpenFreeMap's dark fiord style, north up: a tide is a gauge filled to where the water sits between its turns, teal while rising and amber while falling, and a current is an arrow toward its set, green at slack and otherwise colored by its speed. Readings and gauges appear from zoom 9.5 and names from 10.5. Each 44 px cell keeps one station instead of clustering, and pins update each minute. A tap shows the station's `StationCard` in a bottom panel, and `onStationSelect` fires when that card is tapped rather than when the pin is. The map carries a "Not for navigation." notice, a locate button that centers on the reader at zoom 10.5, and its attribution top-right.

`clustering`, `clusterMaxZoom`, `clusterRadius`, and `popupContent` are removed. `mapStyle` defaults to fiord, and `threshold` and `now` are new. `useThemeColors` adds `go`, `graphHigh`, and `graphLow`. `timelineQuery`, `extremesQuery`, and `currentTimelineQuery` return the query key and function behind `useTimeline`, `useExtremes`, and `useCurrentTimeline`.
