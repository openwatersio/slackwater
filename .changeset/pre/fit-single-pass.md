---
"@slackwater/engine": patch
---

`fit` evaluates the astronomy once per sample and solves with its own batched QR, so a 210-day fit runs about three times faster, and `@slackwater/engine` no longer depends on `ml-matrix`.
