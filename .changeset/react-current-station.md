---
"@slackwater/react": minor
---

Add `CurrentStation` and `CurrentScrubber` for tidal current stations: a timeline that scrolls under a fixed reading line, after the Slackwater app. It shows the speed, set, and state at the selected moment, green slack windows sized by a boat-speed threshold, speed-coloured maxima, sunrise and sunset, and pills that name the next event and return to now. New client functions and hooks fetch current stations, events, and timelines from the API.
