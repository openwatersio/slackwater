---
"@slackwater/engine": major
---

Store each constituent's Doodson coefficients and compound members in the catalog, and predict from definitions the caller supplies. `createTidePredictor`, `createCurrentPredictor` and `fit` take a `definitions` option that adds constituents to the catalog or replaces catalog entries of the same name, and `defineConstituents` builds the same models directly. Predictions are unchanged.

Breaking change for TypeScript consumers of the catalog's types: `DefineConstituentOptions` is now `ConstituentDefinition`, with `coefficients` in place of `xdo` and no `nodalCorrection`, and the `XDO` and `NodalCorrectionCode` types are gone.
