---
"@slackwater/engine": patch
---

Predict M3, S3 and M7 at Schureman's phase, 1.5 times M2's or S2's argument and 3.5 times M2's. They were 180° off, which put up to twice their amplitude into predictions. NOAA publishes M3 at this phase, and so do XTide and the IOS package. Stored phases for these lines that were fitted with an earlier engine, or converted to match it, need turning by 180°: this includes TICON's M3 and S3 in `@slackwater/database` builds made for an earlier engine. CHS tide fits from `chsTideFit` have no stamp to mark them stale, so fit any saved one again.
