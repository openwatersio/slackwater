---
"@slackwater/engine": minor
---

Add `chsCurrentFit.stamp`, which identifies the CHS current gate recipe. It changes whenever the recipe or the fitting and prediction code would move a fixed synthetic gate's predicted velocity by 1e-4 kn or more, a slack or peak by 30 seconds or more, or a peak's speed by 0.001 kn or more, so a fitted model and a validation result can record which recipe they came from. SlackwaterKit and the Kotlin engine export the same value as `ChsCurrentFit.stamp` and `ChsCurrentFit.STAMP`.
