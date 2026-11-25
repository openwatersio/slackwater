---
"@slackwater/react": minor
---

`<SummaryTiles>` and `<RangeOutlook>` are exported for pages that draw their own strip, with `rangeTile`, `nextMaxTile`, `fortnightWindow`, `outlookWindow`, `useOutlookWeek` and `swingHeights` to fill them from predictions the page already has. `<RangeOutlook>` takes its highs and lows as a prop and loads nothing itself. Without a `time`, the tiles server-render with no reading, at the size they keep once the browser passes the moment.
