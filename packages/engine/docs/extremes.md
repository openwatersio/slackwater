# How extremes are found and filtered

This page explains how the TypeScript engine and the Swift and Kotlin ports turn a harmonic prediction into a list of high and low waters, why the spurious-extreme filter works the way it does, and how it was checked against official tide tables. Read it before changing `packages/engine/src/harmonics/extremes.ts`, `swift/Sources/SlackwaterKit/Extremes.swift` or `kotlin/src/main/kotlin/io/openwaters/slackwater/Extremes.kt`. The three share one design, and a change to one belongs in all of them.

The extremes of any window are exactly the extremes of a longer window that fall inside it. A card asking for the next 30 hours, a widget asking for 48 and a calendar asking for a month name the same turns ([#436](https://github.com/openwatersio/slackwater/issues/436)). Every step below is built to keep that true.

## Finding turning points

The predicted height is a sum of cosines, h(t) = Σ A·cos(ω·t + φ), so its first and second derivatives have closed forms. High and low waters are the roots of h'(t).

`findExtremes` finds turning points one UTC day at a time. Each day is searched from its own midnight, in brackets a quarter period of the fastest constituent long, π / (2·ω_max), so a day's brackets, and therefore its turning points, are the same whichever window asks for it. It evaluates h' at every bracket boundary. When h' has opposite signs at the two ends of a bracket, it bisects that bracket to within one second and classifies the root by the sign of h''(t): negative is a high, positive is a low. Z0, the mean-level offset, has zero speed, so it shifts heights without moving any root.

The sign test only sees an odd number of roots in a bracket. Two roots inside one bracket, such as a short stand on a rising tide, are both missed, and three are reported as one. The code comment that says h' has at most one zero crossing per quarter period is wrong, and [#362](https://github.com/openwatersio/slackwater/issues/362) tracks it. A turn missed this way is narrower than a bracket, so it tends to be shallow, but nothing guarantees it would fall below the filter threshold.

Roots that land exactly on a bracket boundary are not guaranteed to be reported ([CONTRACT.md](../../../docs/CONTRACT.md)), because the sign test needs h′ to be non-zero at both ends.

## Node corrections and the 24-hour refresh

Node factors (f and u) change slowly over the 18.6-year nodal cycle. Each day's search takes its own parameters, anchored at its midnight, with node factors evaluated at its noon and the equilibrium argument V0 from its midnight: `paramsFrom` in `prediction.ts` and `currents.ts`, and a `ParamProvider` per day in Swift and Kotlin. One set holds for the whole day.

Fresh parameters take effect at midnight, and the small change in them can move a root across it. If each day evaluated h′ at midnight with its own parameters, a turn the incoming parameters put before midnight and the outgoing ones after it would change sign in neither day and be lost. At Cambridge, MD (noaa/8571892) that dropped the low of 26 July 2026, and with it the high before, whose next turn was then a higher high. A turn put the other way round would be found by both days. So each day's first bracket opens on the previous day's h′ at midnight instead of its own, and the days read as one sequence of h′ samples: a sign change between the two days' parameters is a turn at midnight, and a turn the previous day already found is not found again. `fixtures/extremes-midnight.json` holds the Cambridge case for all three engines.

In Swift, `ranges()` in `Ranking.swift` collapses a same-kind run to its true extreme, which covers the reordering that unequal subordinate time offsets can cause.

## Removing spurious extremes

A harmonic curve has many tiny turning points, such as stands where the tide pauses and wiggles from small shallow-water constituents. The filter keeps an extreme by its **persistence**: a high survives when, in each direction, the tide falls at least `prominenceThreshold` below it before rising above it. A low survives when the tide rises at least the threshold above it before falling below it.

Away from the ends of a long list, and unless two extremes have exactly the same height, that keeps what this pair rule keeps:

1. Find the neighbouring pair with the smallest difference in height.
2. If that difference is below `prominenceThreshold`, remove both.
3. Repeat until every pair differs by at least the threshold.

The pair rule is what NOAA's tabulation rule describes (see below). Over 19 years of a mixed tide and of a double tide, at 0.01 m and 0.03 m, the two keep identical lists, and an extreme-by-extreme comparison on random alternating lists agrees away from the ends.

Removing a low together with its high keeps highs and lows alternating. A small stand on a falling tide produces a low and a high a few millimetres apart. Removing only the low would leave the high stranded between the real high and the next low, often near mid-tide, where nothing removes it, and the list would show two highs in a row ([#357](https://github.com/openwatersio/slackwater/issues/357)). Persistence removes the stand's low and high together, because neither clears the threshold against a turn of its own kind. A sub-threshold run keeps its true extreme.

Of two neighbouring turns at exactly the same level, as in a list given to `filterExtremes` with a turn repeated, one survives: an equal turn counts as higher on its left only. The same rule would drop the later of two separate extremes at exactly the same level, which needs bit-identical heights.

### Deciding from each extreme's own neighbourhood

The pair rule decides an extreme from the whole list it is given, so a run of turns below the threshold can filter differently depending on where the list starts and ends. Persistence decides each extreme from the turning points around it, so the result never depends on the window. All three engines widen a window to whole 10-minute steps before searching, so the guarantee is between windows widened that way. It covers harmonic stations; a subordinate station's extremes still depend on its window (see Subordinate stations below and [CONTRACT.md](../../../docs/CONTRACT.md)).

Most extremes are decided within hours. At micro-tidal stations, whose daily turns are all below the threshold, the extremes that persist are set by the fortnightly and monthly cycles, and the deciding turn can be more than a week away. `findExtremes` therefore searches the window's own days first and adds days at either end only while an extreme is still undecided. The nearest turn on each side always counts, however far away, up to 400 days, so a tide made of the annual and semiannual cycles alone still has its yearly high and low. Past the nearest turn, the search looks at most 32 days from an extreme, past MSf (14.8 days) and MM (27.6 days). An extreme still undecided there is dropped. So is one with no deciding turn before the end of a list given to `filterExtremes` directly. Where every turn for more than 32 days is below the threshold, that can drop one extreme of a high-low pair, for example a flat seasonal low between daily turns of a few millimetres, and leave two of a kind in a row. No station in the database does this over 2024–2026.

A threshold of zero keeps every turning point unfiltered, which is what the subordinate fallback below relies on.

A one-day search costs about what it did with a fixed 25-hour context, and so does a year. At Victoria, a 30-hour search takes 0.08 ms and a year 8.6 ms in Node, against 0.09 ms and 8.0 ms before. At a gauge whose every turn is a few millimetres, where extremes wait longer for their deciding turn, a 30-hour search takes 0.16 ms against 0.07 ms, and a year 5.8 ms against 4.8 ms. A year of current events at PUG1741, 25 constituents, takes 105 ms against 92 ms, since each day's search now finds its own context. For a current of a few thousandths of a knot, whose maxima wait days for their deciding turn, a year takes 35 to 50 ms against 20 to 30 ms, at most about twice as long, including M2 and S2 within a millimetre of each other.

### Subordinate stations

A subordinate station's curve is drawn between the reference station's extremes: the TypeScript timeline maps the reference curve between neighbouring keyframes, and the Swift port draws a half-cosine between corrected extremes. Both need at least two. When the reference's extremes don't surround the window, because every turn is below the threshold or the kept ones are days apart, all three engines fall back to the reference's raw turning points (`prominenceThreshold` of 0). With identity offsets, the subordinate curve then matches the reference curve. A reference with no turning points at all, such as one that is only a mean-level offset, still has nothing to interpolate between, and the TypeScript timeline throws. Whether the fallback applies depends on which extremes the padded window holds, so a subordinate station's extremes, unlike a harmonic station's, can depend on its window.

### Where the rule comes from

NOAA CO-OPS writes its rule for tabulating observed tides as a rule about successive high and low tides, which makes it a pair rule:

> successive high and low tides shall not be tabulated unless they are greater than 2.0 hours apart in time and 0.030 meters different in elevation.

The source is [Water Level Station Specifications and Deliverables for Shoreline Mapping Projects](https://tidesandcurrents.noaa.gov/publications/Water_Level_Station_Specifications_and_Deliverables_for_Shoreline_Mapping_Projects,_Updated_May_2009.pdf) (NOAA CO-OPS, May 2009), §1.3.2, and it applies to 6-minute observed data. Parker's [Tidal Analysis and Prediction](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) (NOAA Special Publication NOS CO-OPS 3, 2007), §3.9.1, describes the same "cut-off criteria to eliminate unwanted computer selections". On double tides it says only that the method "must decide whether the second maximum is significant enough to be considered as a double high water", and it gives no threshold. It adds that "the important thing is consistency, namely, to use the same method for all the data and predictions."

### Why the threshold is 0.01 m

The default `prominenceThreshold` is 0.01 m, the `min_prominence` that Rijkswaterstaat and Deltares use in hatyan's `calc_HWLW` ([`hatyan/timeseries.py`](https://github.com/Deltares/hatyan/blob/ef612657a9d83950010dccf12333dc1849ab63d1/hatyan/timeseries.py#L48-L192), line 120). hatyan passes it to `scipy.signal.find_peaks` as topographic prominence. Topographic prominence is the persistence the filter measures: how far the curve falls from a high, or rises from a low, before it passes it.

NOAA's 0.030 m tabulation rule doesn't fit predictions, because NOAA's published predictions don't apply it. In the 2025 NOAA hi/lo tables fetched for the validation below, 27,720 successive high-low pairs differ by less than 0.03 m, and 7,119 by less than 0.01 m.

The TypeScript engine takes the threshold as the `prominenceThreshold` option of `createTidePredictor`. The Swift port uses 0.01 for `Station.extremes`. `CurrentStation.maxima` runs the same finder and filter on velocity, where 0.01 is in knots.

### Why there is no time test

The filter judges extremes by height alone.

hatyan finds highs and lows as separate series, each with `distance=M2period_numsteps/1.85`. That sets a minimum spacing of about 6.7 hours between two highs or between two lows, together with a minimum peak width of 2 hours. The divisor is tuned by hand per station, and the comments beside the call (lines 143-145) record the trade-offs, for example "1.9 results in all HW values for LITHDP 2022 (but too much HW for Dordrecht 2025)". hatyan has no double-tide switch. A spacing rule like this belongs to a method that finds highs and lows separately. On an alternating list it would have to remove pairs again, and in mixed tides it would delete the small daily cycle.

NOAA's 2-hour rule is for observed data. NOAA's predictions keep 2,617 successive high-low pairs less than 2 hours apart, and 411 less than an hour apart, at the stations validated below. Genuine aggers at shallow-water stations such as Krimpen a/d Lek and Bournemouth are often less than 2 hours apart too.

Doodson's criterion says a double high water can only form when b·n²/a > 1. For a quarter-diurnal oscillation (n = 2) that means "the amplitude must be at least one-fourth that of the semi-diurnal tide". The source is Doodson and Warburg's Admiralty Manual of Tides (1941), as quoted by Byrne, Green and Bowers in [The double high tide at Port Ellen: Doodson's criterion revisited](https://doi.org/10.5194/os-13-599-2017) (Ocean Science 13, 2017). The criterion is necessary but not sufficient, and it applies to the amplitudes on the day. Without a time test there is nothing for a double-tide criterion to switch off, so the engine has none. An agger is kept wherever its dip clears the threshold, at any station.

## Rejected alternatives

| Alternative                                                | Why it was not used                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove one extreme at a time                               | It can leave two highs or two lows in a row after removing one side of a stand. See the validation results.                                         |
| The pair rule over the window plus 25 hours of context     | Its answer depends on the window wherever a sub-threshold run outlasts the context ([#436](https://github.com/openwatersio/slackwater/issues/436)). |
| The pair rule over each UTC day on its own                 | Neighbouring days can disagree about a pair near midnight, which leaves two highs or two lows in a row.                                             |
| Persistence within a fixed 25 hours                        | Micro-tidal stations need more: 210 same-kind neighbours at 62 stations in 2025, against none with the 32-day limit.                                |
| A 2-hour test on high-low pairs                            | It removes events NOAA publishes, and genuine aggers.                                                                                               |
| A minimum spacing between same-kind extremes, as in hatyan | It needs tuning per station, it only works on highs and lows found as separate series, and it deletes the small cycle of mixed tides.               |
| A 0.03 m threshold, as in NOAA's tabulation rule           | NOAA's own predictions keep smaller turns, so more published events would go missing.                                                               |
| A separate filter for each tide type                       | See below.                                                                                                                                          |

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

`benchmarks/extremes.ts` (`npm run benchmarks:extremes`) repeats the alternation half of this check locally. It covers every tide station for two calendar years from `YEAR` (default 2025) and writes per-station counts to `benchmarks/extremes.csv`. The NOAA and CHS benchmarks write matched, missed and extra counts for each station to `noaa.csv` and `chs.csv` over a rolling window, so running them on two commits reproduces the official-table comparison.

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

Under pair removal, every same-kind pair left spans a node-correction refresh, and each one also appears under single removal. Persistence, below, leaves none.

Pair removal matches slightly fewer events, for two reasons.

Some official tables keep a stand that the model puts under 1 cm. At NOAA 1612376, for example, the table lists a low of 0.215 m and a high of 0.253 m 55 minutes apart. Single removal kept the model's stranded high, which happened to coincide with the table's high. Pair removal reports neither, so both count as missed. Where a table has no stand, the same stranded high counts as extra, which is why extra events fall much further than matched events.

NOAA's tables for Galveston's subordinate stations (8764634, TEC4723 and 8764256) keep the later and lower of a flat double high. NOAA's own 6-minute curve for Galveston (8771450) puts the higher high first, and Galveston's own hi/lo table lists both. Pair removal keeps the higher, earlier one, which is more than 3 hours from the subordinate table's high, and those stations gain up to 38 missed plus extra events a year.

### Persistence and window independence

Measured on 2026-10-19 against the pair rule over a 25-hour context, for 2025 at every tide station in `@slackwater/database`:

- Same-kind neighbours (`benchmarks/extremes.ts`, 2025–2026): none at 6,135 stations, against 31 or fewer in 2025 before. A one-off run over 2024–2026 found none either.
- Extremes reported: 8,075,078 against 8,075,049. 84 stations differ, mostly by one to four a year. The largest change is 10 fewer at Southampton.
- `FAST` NOAA benchmark, the same 220 stations: MAE p50 / p90 / p95 0.00817 / 0.01044 / 0.01187 m and median time error p95 6.03 min, unchanged to the third significant figure.
- `FAST` CHS benchmark, 184 stations: MAE p50 0.0580 m, unchanged.

Each day being searched from its own midnight moves turning points by up to about half a second against a search anchored at the window start.

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

`swift/Sources/SlackwaterKit/Extremes.swift` and `kotlin/src/main/kotlin/io/openwaters/slackwater/Extremes.kt` port `findExtremes`, `filterExtremes` and the persistence rule, and their `ParamProvider` follows `paramsFrom`. The parity gates are `fixtures/extremes-victoria.json` and `fixtures/extremes-midnight.json`, generated from the TypeScript engine by `fixtures/generate/gen-golden.mjs`. The Swift and Kotlin tests must match it exactly in count and kind, within 60 seconds in time, and within 0.02 m in height ([CONTRACT.md](../../../docs/CONTRACT.md)). A change to one port goes in all three, and `npm run fixtures:check`, `swift test -c release` and the Kotlin lane must pass. All three test that extremes alternate over 19 years of a mixed tide and that overlapping windows report the same extremes, at Victoria and at a gauge whose every turn is a few millimetres.

## Open questions

NOAA's tables keep turns smaller than 1 cm, and micro-tidal stations show genuine centimetre-scale extremes. A threshold relative to each station's range, calibrated against the official tables with the method above, may fit both better than any single fixed value.

NOAA's subordinate tables for Galveston keep the later high of a flat double high, while the reference curve says the earlier one is higher. The engine follows the curve. Copying NOAA's choice for subordinates would win back those matches, but the engine would then report a lower high than its own curve predicts.

Turns missed inside one bracket ([#362](https://github.com/openwatersio/slackwater/issues/362)) are lost from every window alike.
