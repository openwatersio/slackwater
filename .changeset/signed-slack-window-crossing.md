---
"@slackwater/engine": patch
---

Place `slackWindows` edges correctly when the current reverses and crosses the threshold within one sample step. The edge now comes from the signed speed, as in `@slackwater/react`, instead of landing late or early.
