---
"@slackwater/engine": minor
---

`fit` takes per-sample `weights`, fits robustly with `robust: true`, drops constituents the record can't separate with `dropDependent: true` instead of failing, and gives each constituent a 95% confidence interval and signal-to-noise ratio with `confidence: true`. `HarmonicFit` gains a required `dropped` list, so code that builds a `HarmonicFit` by hand must add it.
