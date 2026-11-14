---
"@slackwater/react": patch
---

`<TideScrubber>` and `<CurrentScrubber>` call `onSelect` once for each new moment, so the opening glide reports where it lands once instead of on every frame. A new `onSelect` is called once with the current moment.
