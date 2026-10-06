# How extremes are found and filtered

This page explains how the TypeScript engine and the Swift port turn a harmonic prediction into a list of high and low waters, why the spurious-extreme filter works the way it does, and how it was checked against official tide tables. Read it before changing `packages/engine/src/harmonics/extremes.ts` or `swift/Sources/SlackwaterKit/Extremes.swift`. The two ports share one design, and a change to one belongs in the other.

## Finding turning points

The predicted height is a sum of cosines, h(t) = Σ A·cos(ω·t + φ), so its first and second derivatives have closed forms. High and low waters are the roots of h'(t).

`findExtremes` walks the requested window, plus 25 hours of context on each side, in fixed brackets, each a quarter period of the fastest constituent long: π / (2·ω_max). The context is a whole number of brackets, so the bracket boundaries inside the window fall where they would without it. It evaluates h' at every bracket boundary. When h' has opposite signs at the two ends of a bracket, it bisects that bracket to within one second and classifies the root by the sign of h''(t): negative is a high, positive is a low. Z0, the mean-level offset, has zero speed, so it shifts heights without moving any root.

The sign test only sees an odd number of roots in a bracket. Two roots inside one bracket, such as a short stand on a rising tide, are both missed, and three are reported as one. The code comment that says h' has at most one zero crossing per quarter period is wrong, and [#362](https://github.com/openwatersio/slackwater/issues/362) tracks it. A turn missed this way is narrower than a bracket, so it tends to be shallow, but nothing guarantees it would fall below the filter threshold.

Roots that land exactly on the start or end of the search window are not guaranteed to be reported ([CONTRACT.md](../../../docs/CONTRACT.md)).

## Node corrections and the 24-hour refresh

Node factors (f and u) change slowly over the 18.6-year nodal cycle. Both ports recompute them every 24 hours from the start of the window, evaluated at the middle of each day-long chunk: `correctedParams` in `prediction.ts` and `ParamProvider` in `Prediction.swift`. The equilibrium argument V0 comes from the window start throughout.

Fresh parameters take effect at the first bracket boundary at or after each 24-hour mark. At that boundary h' is evaluated twice: with the outgoing parameters to close one bracket, and with the incoming parameters to open the next. Near a flat turn, where h' stays close to zero for a while, the small change in parameters can move the root across the boundary. If it moves later, neither bracket sees a sign change and the turn is missed. If it moves earlier, both brackets see it and the same turn is reported twice, seconds apart. [#364](https://github.com/openwatersio/slackwater/issues/364) tracks the fix.

What this looks like in practice:

- A missed high-low pair leaves two lows or two highs next to each other. In 2025, every same-kind pair that `benchmarks/extremes.ts` finds spans one of these refreshes.
- The same water can give different answers in different windows. At Patos Island the high at 00:35 UTC on 2025-10-24 appears in a one-day or a seven-day search, but not in a search of the whole year.
- The filter drops one copy of a turn that was counted twice (see below). It cannot restore a turn that was never found.

In Swift, `ranges()` in `Ranking.swift` collapses a same-kind run to its true extreme. That covers these misses and the reordering that unequal subordinate time offsets can cause.

## Removing spurious extremes

A harmonic curve has many tiny turning points, such as stands where the tide pauses and wiggles from small shallow-water constituents. `filterExtremes` removes the ones too small to matter:

1. Among neighbouring pairs that include neither the first nor the last extreme, find the one with the smallest difference in height.
2. If that difference is below `prominenceThreshold`, remove both. If the two are the same kind (one turn the root finder counted twice), remove one of them.
3. Repeat until every such pair differs by at least the threshold.

The first and last extremes are never removed. Each has one neighbour outside the list, so there is nothing to judge it against, and removing it could take the real high of a double high water whose second high lies just outside. As a result, a list of two or more extremes always keeps at least two.

Away from the ends, this is the same as removing the least prominent extreme together with its neighbour on its low-prominence side, where an extreme's prominence is the smaller of its height differences to its two neighbours.

Removing both members of a pair keeps highs and lows alternating, because raw turning points alternate. A small stand on a falling tide produces a low and a high a few millimetres apart. Removing only the low would leave the high stranded between the real high and the next low, often near mid-tide, where its prominence against its new neighbours is large and nothing removes it. The list would then show two highs in a row ([#357](https://github.com/openwatersio/slackwater/issues/357)). Pair removal also lets a sub-threshold run keep its true extreme: the smaller height difference always sits next to the less extreme member, so that member is the one removed.

### Context beyond the window

The filter judges each extreme against its neighbours, so an extreme near the edge of the requested window needs the neighbours that lie outside it. `findExtremes` therefore searches 25 hours past each end, just over a lunar day of 24.84 hours, filters that longer list, and then crops it to the window. Every extreme in the window is filtered against the same neighbours as in a longer search. A window that starts or ends inside a shallow double high reports the same high as a run of several days does. Filtered on its own, the window could lose that high or keep the lower one.

The limit is a run of sub-threshold turns longer than the context, which can still filter differently from a longer search. A one-day search costs about twice as much as it would without the context, and a year-long search costs the same.

### Subordinate stations

A subordinate station's curve is drawn between the reference station's extremes: the TypeScript timeline maps the reference curve between neighbouring keyframes, and the Swift port draws a half-cosine between corrected extremes. Both need at least two. When every turn of the reference tide is below the threshold, the cropped list can hold fewer than two, and both ports fall back to the reference's raw turning points (`prominenceThreshold` of 0). With identity offsets, the subordinate curve then matches the reference curve. A reference with no turning points at all, such as one that is only a mean-level offset, still has nothing to interpolate between, and the TypeScript timeline throws.

### Where the rule comes from

NOAA CO-OPS writes its rule for tabulating observed tides as a rule about successive high and low tides, which makes it a pair rule:

> successive high and low tides shall not be tabulated unless they are greater than 2.0 hours apart in time and 0.030 meters different in elevation.

The source is [Water Level Station Specifications and Deliverables for Shoreline Mapping Projects](https://tidesandcurrents.noaa.gov/publications/Water_Level_Station_Specifications_and_Deliverables_for_Shoreline_Mapping_Projects,_Updated_May_2009.pdf) (NOAA CO-OPS, May 2009), §1.3.2, and it applies to 6-minute observed data. Parker's [Tidal Analysis and Prediction](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) (NOAA Special Publication NOS CO-OPS 3, 2007), §3.9.1, describes the same "cut-off criteria to eliminate unwanted computer selections". On double tides it says only that the method "must decide whether the second maximum is significant enough to be considered as a double high water", and it gives no threshold. It adds that "the important thing is consistency, namely, to use the same method for all the data and predictions."

### Why the threshold is 0.01 m

The default `prominenceThreshold` is 0.01 m, the `min_prominence` that Rijkswaterstaat and Deltares use in hatyan's `calc_HWLW` ([`hatyan/timeseries.py`](https://github.com/Deltares/hatyan/blob/ef612657a9d83950010dccf12333dc1849ab63d1/hatyan/timeseries.py#L48-L192), line 120). hatyan passes it to `scipy.signal.find_peaks` as topographic prominence. That differs a little from the height difference to the neighbouring extreme used here, but it works at the same scale.

NOAA's 0.030 m tabulation rule doesn't fit predictions, because NOAA's published predictions don't apply it. In the 2025 NOAA hi/lo tables fetched for the validation below, 27,720 successive high-low pairs differ by less than 0.03 m, and 7,119 by less than 0.01 m.

The TypeScript engine takes the threshold as the `prominenceThreshold` option of `createTidePredictor`. The Swift port uses 0.01 for `Station.extremes`. `CurrentStation.maxima` runs the same finder and filter on velocity, where 0.01 is in knots.

### Why there is no time test

The filter judges extremes by height alone.

hatyan finds highs and lows as separate series, each with `distance=M2period_numsteps/1.85`. That sets a minimum spacing of about 6.7 hours between two highs or between two lows, together with a minimum peak width of 2 hours. The divisor is tuned by hand per station, and the comments beside the call (lines 143-145) record the trade-offs, for example "1.9 results in all HW values for LITHDP 2022 (but too much HW for Dordrecht 2025)". hatyan has no double-tide switch. A spacing rule like this belongs to a method that finds highs and lows separately. On an alternating list it would have to remove pairs again, and in mixed tides it would delete the small daily cycle.

NOAA's 2-hour rule is for observed data. NOAA's predictions keep 2,617 successive high-low pairs less than 2 hours apart, and 411 less than an hour apart, at the stations validated below. Genuine aggers at shallow-water stations such as Krimpen a/d Lek and Bournemouth are often less than 2 hours apart too.

Doodson's criterion says a double high water can only form when b·n²/a > 1. For a quarter-diurnal oscillation (n = 2) that means "the amplitude must be at least one-fourth that of the semi-diurnal tide". The source is Doodson and Warburg's Admiralty Manual of Tides (1941), as quoted by Byrne, Green and Bowers in [The double high tide at Port Ellen: Doodson's criterion revisited](https://doi.org/10.5194/os-13-599-2017) (Ocean Science 13, 2017). The criterion is necessary but not sufficient, and it applies to the amplitudes on the day. Without a time test there is nothing for a double-tide criterion to switch off, so the engine has none. An agger is kept wherever its dip clears the threshold, at any station.

## Rejected alternatives

| Alternative                                                | Why it was not used                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Remove one extreme at a time                               | It can leave two highs or two lows in a row after removing one side of a stand. See the validation results.                           |
| A 2-hour test on high-low pairs                            | It removes events NOAA publishes, and genuine aggers.                                                                                 |
| A minimum spacing between same-kind extremes, as in hatyan | It needs tuning per station, it only works on highs and lows found as separate series, and it deletes the small cycle of mixed tides. |
| A 0.03 m threshold, as in NOAA's tabulation rule           | NOAA's own predictions keep smaller turns, so more published events would go missing.                                                 |
| A separate filter for each tide type                       | See below.                                                                                                                            |

### A filter per tide type

One option is to classify each station by its form factor, F = (K1 + O1) / (M2 + S2), using the bands in [IHO C-13, chapter 5](https://iho.int/uploads/user/pubs/cb/c-13/english/C-13_Chapter_5.pdf), §2.1.5.2: below 0.25 semidiurnal, 0.25 to 1.5 mixed mainly semidiurnal, 1.6 to 3.0 mixed mainly diurnal, above 3.0 diurnal. Each class would get its own filter. For example, purely semidiurnal and purely diurnal stations could use a hatyan-style spacing rule, and mixed stations the height rule alone.

The difficulty is that F is fixed for a station while its tide's regime is not. Parker (2007, §2.2.5) classifies Victoria as mixed, mainly diurnal. He notes that on many days the two highs and the low between them are so close in height that "the tide looks diurnal with a double high water", and that counting those days, "the tides are actually diurnal 77% of the time at Victoria." Shallow-water stations such as Krimpen a/d Lek are semidiurnal by F and still have real aggers. hatyan's per-station tuning shows the cost of a time criterion: someone has to adjust it until each station looks right.

The validation losses below trace back to the height threshold, so calibrating the threshold comes first. After that, a spacing rule for stations with F < 0.25 or F > 3 could be tried. It should be kept only if it reduces missed plus extra events without reducing matched events at mixed and shallow-water stations.

## Validation

### Method

The check compares the engine's extremes with the official hi/lo tables published by NOAA CO-OPS and the Canadian Hydrographic Service (CHS). It compares two filters, pair removal and single removal, at every station where they produce different lists. Stations where they agree would add identical numbers to both columns.

- Stations: every tide station in `@slackwater/database` whose source is NOAA (`source.url` contains `tidesandcurrents.noaa.gov`), plus every TICON station from Canada's MEDS archive (ids ending in `-can-meds`, which embed the CHS station code).
- Window: calendar year 2025, UTC.
- Model: `findStation(id).getExtremesPrediction({ start, end })`. NOAA stations use their default datum and CHS stations use `datum: "LAT"`. For each comparison the model window runs from 3 hours before the first official event to 3 hours after the last.
- NOAA tables: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20250101&end_date=20251231&station=<id>&datum=<default datum, else MTL>&product=predictions&interval=hilo&units=metric&time_zone=gmt&format=json`. The API answers 403 Forbidden under concurrent load; two requests at a time worked.
- CHS tables: the IWLS API at `https://api-sine.dfo-mpo.gc.ca/api/v1`, used the same way as `benchmarks/chs.ts`.
  - Look the station up with `stations?code=<5-digit code>`.
  - Read its LAT offset from `stations/<id>/metadata`, using the height type whose code is `LAT` in `height-types`.
  - Fetch `stations/<id>/data?time-series-code=wlp-hilo&from=2025-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`.
  - CHS rows carry no high or low label, so label each row by comparing it with the next one, and the last row with the previous one. Shift levels from chart datum to LAT by subtracting the LAT offset.
- Matching uses the same code as `benchmarks/noaa.ts` and `benchmarks/chs.ts`.
  - Highs are matched with highs and lows with lows, separately, in time order.
  - For each official event, model events more than 3 hours earlier count as extra.
  - The closer of the next two model events is matched if it lies within 3 hours, and each model event matches at most once.
  - Otherwise the official event counts as missed.
  - Model events left over at the end count as extra.

`benchmarks/extremes.ts` (`npm run benchmarks:extremes`) repeats the alternation half of this check locally. It covers every tide station for one calendar year (`YEAR`, default 2025) and writes per-station counts to `benchmarks/extremes.csv`. The NOAA and CHS benchmarks write matched, missed and extra counts for each station to `noaa.csv` and `chs.csv` over a rolling window, so running them on two commits reproduces the official-table comparison.

### Results for 2025

|                                                               | Single removal             | Pair removal               |
| ------------------------------------------------------------- | -------------------------- | -------------------------- |
| Same-kind neighbours, NOAA and MEDS stations                  | 17,104 at 1,078 stations   | 13 at 12 stations          |
| NOAA tables, 990 stations: matched                            | 1,147,744                  | 1,143,467                  |
| NOAA tables: missed                                           | 12,097                     | 16,374                     |
| NOAA tables: extra                                            | 16,131                     | 6,093                      |
| NOAA tables: missed plus extra                                | 28,228                     | 22,467                     |
| NOAA, mean absolute height error per station, p50 / p90 / p95 | 0.0041 / 0.0099 / 0.0137 m | 0.0041 / 0.0099 / 0.0137 m |
| NOAA, median absolute time error per station, p95             | 6.00 min                   | 6.00 min                   |
| CHS tables, 54 stations: matched                              | 69,264                     | 69,087                     |
| CHS tables: missed plus extra                                 | 3,493                      | 3,294                      |

Every same-kind pair left under pair removal spans a node-correction refresh, and each one also appears under single removal.

Pair removal matches slightly fewer events, for two reasons.

Some official tables keep a stand that the model puts under 1 cm. At NOAA 1612376, for example, the table lists a low of 0.215 m and a high of 0.253 m 55 minutes apart. Single removal kept the model's stranded high, which happened to coincide with the table's high. Pair removal reports neither, so both count as missed. Where a table has no stand, the same stranded high counts as extra, which is why extra events fall much further than matched events.

NOAA's tables for Galveston's subordinate stations (8764634, TEC4723 and 8764256) keep the later and lower of a flat double high. NOAA's own 6-minute curve for Galveston (8771450) puts the higher high first, and Galveston's own hi/lo table lists both. Pair removal keeps the higher, earlier one, which is more than 3 hours from the subordinate table's high, and those stations gain up to 38 missed plus extra events a year.

### Stations from #219

[#219](https://github.com/openwatersio/slackwater/issues/219) reported too many extremes, some close together with no visible change in height, at micro-tidal Baltic stations and at Krimpen a/d Lek, a Dutch river station with strong shallow-water tides. For 2025:

| Station                              | Extremes per day | Same-kind neighbours, single removal | Same-kind neighbours, pair removal | Neighbours less than 2 h apart |
| ------------------------------------ | ---------------- | ------------------------------------ | ---------------------------------- | ------------------------------ |
| `ticon/vahemadal-vah-est-cmems`      | 1.98             | 73                                   | 0                                  | 0                              |
| `ticon/tallinn-tal-est-cmems`        | 2.12             | 54                                   | 0                                  | 0                              |
| `ticon/tallinnamadal-tal-est-cmems`  | 1.95             | 33                                   | 0                                  | 0                              |
| `ticon/krimpenadlektg-kri-nld-cmems` | 4.67             | 77                                   | 0                                  | 234                            |

At all four stations, neighbouring extremes differ by at least 1 cm and none round to the same centimetre.

The Baltic stations still show about two extremes a day because their tide is real but tiny. At Vahemadal, M2 is about 0.6 cm while K1 and O1 are about 1.5 cm each. Together the diurnal constituents give a daily range of a few centimetres, so most days have one high and one low more than 1 cm apart. Whether stations this close to tideless should show extremes at all is a question for the station data ([tide-database#49](https://github.com/openwatersio/tide-database/pull/49)) or for a range-relative threshold.

Krimpen's (M4 + MS4) / M2 is about 0.44, well past Doodson's quarter, so double high and low waters are expected there. Its neighbours less than 2 hours apart all differ by at least 1 cm. Under single removal, its 2025 list includes a "high" of 0.53 m straight after a high of 1.62 m. Under pair removal it has no same-kind neighbours.

## Swift parity

`swift/Sources/SlackwaterKit/Extremes.swift` ports `findExtremes` and `filterExtremes` line for line, and `ParamProvider` follows `correctedParams`. The parity gate is `fixtures/extremes-victoria.json`, generated from the TypeScript engine by `fixtures/generate/gen-golden.mjs`. The Swift `ExtremesTests` must match it exactly in count and kind, within 60 seconds in time, and within 0.02 m in height ([CONTRACT.md](../../../docs/CONTRACT.md)). A change to either port goes in both, and `npm run fixtures:check` and `swift test -c release` must pass. Both ports test that extremes alternate over 19 years of a mixed tide.

## Open questions

NOAA's tables keep turns smaller than 1 cm, and micro-tidal stations show genuine centimetre-scale extremes. A threshold relative to each station's range, calibrated against the official tables with the method above, may fit both better than any single fixed value.

NOAA's subordinate tables for Galveston keep the later high of a flat double high, while the reference curve says the earlier one is higher. The engine follows the curve. Copying NOAA's choice for subordinates would win back those matches, but the engine would then report a lower high than its own curve predicts.

The missed and doubled turns at node-correction refreshes ([#364](https://github.com/openwatersio/slackwater/issues/364)) and the misleading bracket comment ([#362](https://github.com/openwatersio/slackwater/issues/362)) are the remaining sources of same-kind neighbours at harmonic stations.
