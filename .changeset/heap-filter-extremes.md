---
"@slackwater/engine": patch
---

Filter spurious extremes with a heap instead of rescanning the list after every removal, so a multi-year search over a station with many small turns no longer slows quadratically.
