---
---

The Swift and Kotlin catalogs carry the engine's definitions for NOAA's shallow-water compounds at Anchorage: MLN2S2, 2NMLS6, 2MLNS6, 3MLS6, 4MLS8, ML4, MKL2S2, 3ML8, MSK5, MP1, 3KM5 and RP1. MLN2S2, 2NMLS6, 2MLNS6, 3MLS6 and 4MLS8 are their own lines, so Kotlin's `constituentAstronomy` returns them under their own names, and a caller's definition that lists one of them as an alias of the line it shared is refused. Refit any of these constituents fitted with an earlier engine.
