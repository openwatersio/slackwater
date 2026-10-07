---
"@slackwater/engine": patch
---

Locate each extreme with Illinois regula falsi instead of bisection. It needs about 4 evaluations per extreme instead of 12, which makes long extremes searches about 20% faster, and it places extremes closer to the true turn.
