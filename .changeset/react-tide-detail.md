---
"@slackwater/react": major
---

`TideStation` is the Slackwater app's tide detail screen: a `TideScrubber` timeline with the reading for the selected moment, a schedule card with the week's highs and lows, where the predictions come from, and the station's details. Heights are always above the station's chart datum. `CurrentStation` shares the layout, with the week's slacks and maxima in its schedule.

The components are dark only. Their colors are the `--sw-*` variables in `styles.css`, which replace the `--slackwater-*` palette, and they need Tailwind CSS v4 with `@source` pointing at the package.

`TideScrubber` is new. `TideGraph`, `TideGraphChart`, `NightBands`, `YAxisOverlay`, `TideTable`, `TideSettings`, `TideStationHeader`, and `TideCycleGraph` are removed, along with the `useTideChunks`, `useTideScales`, `useContainerSize`, `useHashTab`, and `useDarkMode` hooks, `withAlpha`, and `getDefaultRange`. `TideStation` takes only `id` and `className`. `useThemeColors` returns the map's colors from the `--sw-*` variables. `useTimeline` and `useExtremes` take query options, and `prefetchTideStation` fills the queries the new `TideStation` reads.
