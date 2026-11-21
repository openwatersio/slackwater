---
"@slackwater/engine": minor
---

`fit` takes `nodeCorrections`: IHO's (the default), Schureman's, or Foreman's satellite corrections at the site's `latitude`, as t_tide and UTide use. With it, a fit can be compared with the constants agencies using Foreman's method publish. With Foreman's set, `fit` refuses the catalog's Sa, S1 and OQ2 (`notForemanLine`), since t_tide's lines by those names are SA_KV, S1_KV and OQ2_KV.
