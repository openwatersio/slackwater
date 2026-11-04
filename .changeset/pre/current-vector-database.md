---
"@slackwater/engine": patch
"slackwater": patch
"@slackwater/api": patch
"@slackwater/cli": patch
---

Predict magnitude and rotating direction for NOAA harmonic current stations using their published minor-axis data. Station lookups, API timelines, and CLI JSON include the vector predictions automatically. Signed speeds and flood, ebb, and slack events retain their major-axis meaning.

CLI text identifies slack-window thresholds as major-axis speed. The current-station API schema documents both axes.
