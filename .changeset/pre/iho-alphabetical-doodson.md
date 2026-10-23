---
"@slackwater/engine": minor
---

Eight constituents with no numerical Doodson number in the IHO list (3(SM)N2, (SK)K5, 5MSN10, 4M2SN10, 3N2MS12, MA12, 4ML12 and 5MSN12) now take their equilibrium argument from IHO's alphabetical code, except that 3N2MS12 follows its listed speed where its code disagrees. Their phases had advanced at a different rate from their listed speeds, so a prediction using them depended on when it started. `fit` now accepts 3(SM)N2, (SK)K5, 4ML12 and 5MSN12, which it rejected as `rankDeficient` for want of an equilibrium argument. No station in the database uses any of the eight.
