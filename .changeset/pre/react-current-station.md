---
"@slackwater/react": minor
---

Add `CurrentStation` and `CurrentScrubber` for tidal current stations: a timeline that scrolls under a fixed reading line, after the Slackwater app. It shows the speed, set, and state at the selected moment, blue comfort windows sized by a boat-speed threshold and short green strokes at predicted zeros, a curve colored by speed, the speed and set at each maximum, sunrise and sunset, and pills that name the next event and return to now. New client functions and hooks fetch current stations, events, and timelines from the API.

Slack readings use predicted event timestamps, independently of the comfort threshold. Window edges follow the signed curve, overlapping windows merge, and continuous windows retain exact Slack times in green. Maximum flood and ebb times have a separate gray row. The pill walks forward through window opening, Slack, closing, maxima and sun events; the return to Now uses a chevron.
