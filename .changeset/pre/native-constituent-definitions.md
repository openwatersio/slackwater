---
---

Predict and fit constituents the catalog doesn't have, or defines differently, in the Swift and Kotlin engines. `Station`, `CurrentStation` and `fit` take `definitions` with the same shape and rules as `@slackwater/engine`, and an invalid set throws `ConstituentDefinitionError` in Swift or `ConstituentDefinitionException` in Kotlin.
