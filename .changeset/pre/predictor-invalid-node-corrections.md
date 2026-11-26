---
"@slackwater/engine": minor
---

The predictors check `nodeCorrections` as `fit` does. An unknown set throws a `RangeError` beginning with `invalidNodeCorrections`, and a `latitude` given without Foreman's set throws `invalidLatitude`. A null or empty set still means IHO's.
