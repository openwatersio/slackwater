---
"@slackwater/react": minor
---

A server render of `<TideScrubber>` or `<CurrentScrubber>` draws only the stretch around its moment that a strip 720 pixels wide shows, and the browser draws the rest as it loads. A week of Seattle tides now prerenders in under 50 KB of HTML instead of 290 KB.
