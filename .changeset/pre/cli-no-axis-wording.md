---
"@slackwater/cli": patch
---

`slackwater currents` text output drops the word "axis", as the Slackwater app does. Events and timeline rows say Slack instead of Axis slack, and the header no longer ends in "major-axis speed". `currents slack` says "slack windows: flood/ebb speed below 0.5 kn", and the help for `events`, `slack` and `--threshold` follows. JSON output is unchanged.
