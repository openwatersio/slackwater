---
"@slackwater/engine": major
---

Breaking change for code that imports the catalog's types or calls methods on the `constituents` map: `DefineConstituentOptions` is now `ConstituentDefinition`, with Doodson `coefficients` in place of `xdo` and explicit `members` in place of `nodalCorrection`, and the `XDO` and `NodalCorrectionCode` types are gone. The exported `constituents` map has no prototype, so use `Object.hasOwn(constituents, name)` rather than `constituents.hasOwnProperty(name)`. Predictions are unchanged.
