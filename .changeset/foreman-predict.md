---
"@slackwater/engine": minor
---

Predict with Foreman's nodal corrections, so constants fitted with t_tide or UTide, such as Kartverket's, predict the way they were fitted. `createTidePredictor` and `createCurrentPredictor` take `nodeCorrections: "foreman"` with the site's `latitude`, and `useStation` and `useCurrentStation` use the latitude of the station the constants belong to. As `fit` does, the predictors refuse names t_tide gives other lines, Sa, S1 and OQ2, and refuse its H1 and H2 rather than drop them. Phases t_tide publishes for O2, 3KM5, M7 and MSK5 are on other arguments than the engine's.
