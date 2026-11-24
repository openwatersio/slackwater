---
"@slackwater/engine": minor
---

Predict with Foreman's nodal corrections, so constants fitted with t_tide or UTide, such as Kartverket's, predict the way they were fitted. `createTidePredictor` and `createCurrentPredictor` take `nodeCorrections: "foreman"` with the site's `latitude`, and `useStation` and `useCurrentStation` use the station's latitude. As `fit` does, they refuse the catalog's Sa, S1 and OQ2 with Foreman's set; `foremanLines` names t_tide's lines for them.
