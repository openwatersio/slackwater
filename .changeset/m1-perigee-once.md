---
"@slackwater/engine": patch
---

Predictions with the M1 constituent no longer drift out of phase. M1's nodal correction counted the lunar perigee twice, in both the IHO and Schureman sets, and Schureman's M1 also jumped 180° twice in each 8.85-year perigee cycle and had a slightly wrong amplitude factor. A caller's own M1 defined without the perigee in its argument keeps the formula as written.

At stations with a large M1, tide heights move by up to about 15 cm and slack times in strong passes by up to about 12 minutes, mostly closer to NOAA's published predictions. M1 phases fitted with an earlier engine were fitted against the double-counted correction, so refit them.
