---
"@slackwater/engine": major
"slackwater": major
"@slackwater/api": major
"@slackwater/cli": major
"@slackwater/react": major
---

Distinguish minimum flood and ebb currents from maximum flow when the current weakens without reversing. Keep these lulls on the chart and in the schedule, and skip them when showing the next maximum.

Breaking change for every consumer of current events: event kinds include `minFlood` and `minEbb`, and current reading states include `Minimum flood` and `Minimum ebb`. The HTTP API, the CLI JSON output, the engine, and the Swift and Kotlin packages all return the new kinds unconditionally; update exhaustive event and state handling. Swift and Kotlin `maxima()` return only true maxima; use `events()` to retain minimum curve knots. Deploy the API before the React client so lulls are not shown as maxima.
