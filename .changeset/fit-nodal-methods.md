---
"@slackwater/engine": minor
---

`fit` takes `nodeCorrections`: IHO's (the default), Schureman's, or Foreman's satellite corrections at the site's `latitude`, as t_tide and UTide use. It also takes `nodal: "yearly"`, which takes each year's arguments at January 1 and f and u at July 2, as NOAA analyzes a year of observations. With them, a fit can be compared with the constants NOAA and agencies using Foreman's method publish.
