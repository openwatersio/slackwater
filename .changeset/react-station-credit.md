---
"@slackwater/react": minor
---

Show each station's credit wherever its predictions appear. `<NearbyStations>` and `<StationSearch>` print the distinct credits of the stations they show once under the cards, `<TideConditions>` prints its station's credit under the widget (pass `attribution` with the data props), and `<StationsMap>` adds the credits of the stations predicted in view to its attribution control and prints the open card's credit under it. `<StationCredits>` does the same for cards you lay out yourself. `StationSummary` carries `attribution` and `license`, with the new `StationLicense` type.
