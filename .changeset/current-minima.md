---
"@slackwater/engine": major
"slackwater": major
"@slackwater/api": minor
"@slackwater/cli": major
"@slackwater/react": major
---

Distinguish minimum flood and ebb currents from maximum flow when the current weakens without reversing. Keep these lulls on the chart and in the schedule, and skip them when showing the next maximum.

Breaking change for engine and CLI JSON consumers: current event kinds include `minFlood` and `minEbb`, and current reading states include `Minimum flood` and `Minimum ebb`. Update exhaustive event and state handling, including Swift and Kotlin callers. Swift and Kotlin `maxima()` return only true maxima; use `events()` to retain minimum curve knots. The HTTP API preserves legacy kinds unless the client requests the revised event contract. The React HTTP adapter requests and verifies that revision, separates its caches, and requires a server supporting it.
