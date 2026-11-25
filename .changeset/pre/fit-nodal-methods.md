---
"@slackwater/engine": minor
---

`fit` takes `nodeCorrections`: IHO's (the default), Schureman's, or Foreman's satellite corrections at the site's `latitude`, as t_tide and UTide use. With it, a fit can be compared with the constants agencies using Foreman's method publish. With Foreman's set, `fit` refuses the catalog's Sa, S1 and OQ2 (`notForemanLine`), since t_tide's lines by those names are SA_KV, S1_KV and OQ2_KV. The engine exports `foreman(latitude)` and `foremanLines`, the map from Foreman's names to the catalog's.

`selectConstituents` with Foreman's nodal corrections and no `candidates` takes the lines t_tide fits: SA_KV, S1_KV, alpha2, M(KS)2 and OQ2_KV for Foreman's Sa, S1, H1, H2 and OQ2. A caller's own definition under one of those names, or one of their aliases, keeps its place. The default list is unchanged for IHO and Schureman.

`fit` takes `nodal: "yearly"`, which takes each year's arguments at January 1 and f and u at July 2, as NOAA analyzes a year of observations. With it, one-year fits can be averaged as NOAA does to publish a station's constants.
