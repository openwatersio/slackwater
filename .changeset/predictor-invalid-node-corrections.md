---
"@slackwater/engine": patch
---

The predictors throw a `RangeError` beginning with `invalidNodeCorrections` for an unknown `nodeCorrections`, as `fit` does.
