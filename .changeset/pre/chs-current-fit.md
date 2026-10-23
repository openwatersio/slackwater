---
"@slackwater/engine": minor
---

Add `chsCurrentFit` and `projectChsCurrent`, the recipe every Slackwater client uses to fit a Canadian Hydrographic Service current gate: IWLS `wcsp1` speed and `wcdp1` direction projected onto the gate's flood axis, fitted with `fit(samples, chsCurrentFit.basis)` over one of `chsCurrentFit.days`. SlackwaterKit and the Kotlin engine export the same as `ChsCurrentFit`, and the Kotlin engine adds `HarmonicSample`.
