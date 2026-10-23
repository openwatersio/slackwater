---
"@slackwater/react": major
---

`StationCard` is the Slackwater app's station card: a station's name and region, the reading now, and a 25-hour curve with each high, low, maximum, and slack window. It loads its own predictions once it scrolls into view. With both `href` and `onSelect`, a plain click calls `onSelect` in place of following the link, and a modified or middle click opens the link.

`TideConditions` is the app's small home-screen widget: the station's name, the height with an arrow for rising or falling, and a 12-hour curve. It is 170 px tall unless `fill` is set, and takes an optional `name`, `chartDatum`, and `now` with data. Given an `id`, it loads the station first and gives the reason for one the API can't serve, such as `chs-campbell-river`. Its `showDate` prop is removed. `WaterLevelAtTime` is removed.

`NearbyStations` shows tide and current stations together as station cards, nearest first, with their distance in nautical miles. Its `stationId` takes a `kind` for a current station. `StationSearch` follows the app's search: a "Harbor, bay, or channel" field with a clear button, All / Tides / Currents filters, and matching stations of both kinds as cards in a grid, with "No matches" and a notice when it stops at 60. Recent searches are removed. Both call back with the station's new `kind`.

`TideStation` and `CurrentStation` end with the nearest stations and take `onStationSelect`. `StationSummary` has a `kind` of `"tide"` or `"current"`. `fetchCurrentStations`, `useCurrentStations`, and the `CurrentStationSummary` type are new, and `prefetchNearbyStations` fills both lists. `prefetchTideStation` also fills the page's Nearby lists.
