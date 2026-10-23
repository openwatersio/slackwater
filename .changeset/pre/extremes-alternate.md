---
"@slackwater/engine": patch
---

Fix extremes predictions that list two highs or two lows in a row. The spurious-extreme filter removes a sub-threshold low and high together, so it never leaves two of a kind side by side, and a shallow double high water reports the higher of its two highs. Extremes near the start and end of a window are judged against the tide beyond it, so a short window reports the same extremes as a longer one.
