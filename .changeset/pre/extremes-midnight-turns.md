---
"@slackwater/engine": patch
---

A tide turn that falls on 00:00 UTC is no longer lost. Each UTC day's search used its own parameters at midnight, so a turn that the two days' parameters placed a second apart on either side of midnight changed sign in neither day; the filter then dropped the opposite turn next to it as well, and a real high and low disappeared together. Each day's first bracket now opens on the previous day's slope at midnight, so the turn is found once. The Swift and Kotlin engines change the same way.
