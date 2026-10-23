---
"@slackwater/engine": minor
---

A harmonic station's tide extremes and current maxima no longer depend on the window asked for: once windows are widened to whole 10-minute steps, the extremes of any window are exactly the extremes of a longer window that fall inside it. Each UTC day is searched from its own midnight, and each extreme is kept by its persistence, judged from the turning points around it (up to 32 days away at micro-tidal stations) rather than from the window's edges. Highs and lows now alternate at every station in the database over 2025–2026. A threshold of zero returns every turning point, unfiltered. Turning points move by up to about half a second, and 84 of 6,135 stations report a few more or fewer extremes in a year. The Swift and Kotlin engines change the same way.

Node corrections now follow a timeline whose steps are longer than a day. They had fallen one day further behind with each such step, so a year of two-day steps ended with node factors about six months old. TypeScript and Swift now match Kotlin here.
