---
"@slackwater/engine": major
---

Breaking change for TypeScript code that imports the catalog's types: `DefineConstituentOptions` is now `ConstituentDefinition`, with Doodson `coefficients` in place of `xdo` and explicit `members` in place of `nodalCorrection`, and the `XDO` and `NodalCorrectionCode` types are gone. Predictions are unchanged.
