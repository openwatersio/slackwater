---
"@slackwater/engine": patch
---

`chsCurrentFit.stamp` also changes when the catalog changes a basis line's speed, argument or nodal members, and this release changes it because M3 is in the basis. Treat CHS current fits saved under an earlier stamp as unfitted and fit them again; an M3 phase from the old argument would be predicted 180° off.
