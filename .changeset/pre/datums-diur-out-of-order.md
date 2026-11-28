---
"@slackwater/datums": patch
---

Fix `computeDatumsFromObservations` throwing "Cannot set properties of undefined" on a record with almost no tide, such as a Great Lakes gauge, where two high or low waters are read out of time order. At such a record the once-a-day designation of higher highs and lower lows now searches every tide, as NOAA's Tidal Analysis Datum Calculator does, apart from the departures the package README lists, so its MHHW and MLLW can change.
