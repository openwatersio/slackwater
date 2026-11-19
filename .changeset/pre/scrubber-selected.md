---
"@slackwater/react": minor
---

`<TideScrubber>` and `<CurrentScrubber>` take `selected`, the moment the strip opens on. A server render shows that moment's reading and pills, so a page for a shared moment prerenders its own reading, and in the browser the strip opens there without gliding in from now. `onSelect` hears the moment once. `moveTo` still moves the strip later.
