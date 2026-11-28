---
"@slackwater/engine": patch
---

Place `slackWindows` edges correctly when the current reverses and crosses the threshold within one sample step. The edge now comes from the signed speed, as in `slackWindowAround`, instead of landing late or early.
