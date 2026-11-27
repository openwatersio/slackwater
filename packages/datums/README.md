# @slackwater/datums

Tidal datums from harmonic constants or from a record of observed water levels. It computes the mean high and low water levels, mean sea level, the astronomical tide bounds, and the national low-water datums several countries chart to, using [`@slackwater/engine`](https://www.npmjs.com/package/@slackwater/engine) for every prediction.

The package reads no files and makes no network requests: constants and samples go in as plain data, and datums come out as a map of names to heights in metres.

> [!WARNING]
> **Not for navigational use.** Do not use these datums for navigation, or depend on them in any situation where inaccuracies could result in harm to a person or property.

## Install

```sh
npm install @slackwater/datums
```

## Usage

### From harmonic constants

```typescript
import { computeDatums } from "@slackwater/datums";

const constituents = [
  { name: "M2", amplitude: 1.2, phase: 110 },
  { name: "S2", amplitude: 0.4, phase: 140 },
  { name: "K1", amplitude: 0.3, phase: 200 },
  { name: "O1", amplitude: 0.2, phase: 180 },
];

const { start, end, datums, ignoredConstituents } = computeDatums(constituents);
// start 2007-01-01, end 2026-01-01: the pinned epoch, see below
// datums: { HAT, HHWLT, MHHW, MHW, MSL, MTL, MLW, MLLW, LLWLT, LAT, MHWS, MLWS, NLLW, ALLW, TLT }
```

Harmonic datums are relative to mean sea level. `computeDatums(constituents, epoch?, options?)` takes:

- `epoch`: `{ end }` to predict over the 19 years ending at `end` instead of the pinned epoch. The result's `start` and `end` say which period was used, with `end` exclusive.
- `options`: the engine's prediction options. Pass `nodeCorrections` (and `latitude` for Foreman's) to match the corrections the constants were fitted under, and `definitions` for constituents outside the engine's catalog. A numeric `offset`, MSL's height above a gauge zero, shifts every datum into the gauge's frame, and so does a `Z0` constant among the constituents.

Constants go to the engine as given, so it skips names it doesn't know and refuses what it refuses, such as t_tide's H1 and H2 under Foreman's set. The names it skips are listed in `ignoredConstituents`. In `computeDatums`, two entries for one constituent, such as `Sa` and its alias `SA`, throw a `RangeError`, since the prediction would add both waves while an amplitude formula can read only one; the observed path adds both, as the engine does.

### From observed water levels

```typescript
import { computeDatumsFromObservations } from "@slackwater/datums";

const samples = [
  { time: new Date("2021-01-01T00:00:00Z"), level: 2.41 },
  { time: new Date("2021-01-01T00:06:00Z"), level: 2.47 },
  // ...
];

const result = computeDatumsFromObservations(samples, constituents, {
  nodeCorrections: "schureman",
});
if (result) {
  const { start, end, datums, coverage, ignoredConstituents } = result;
  // datums: { MHHW, MHW, MSL, MTL, MLW, MLLW } in the gauge's frame
  // coverage counts months, observed hours and inferred hours
}
```

Samples are `{ time, level }`, the same shape as the engine's predicted points, at any cadence. The result is `null` when the record holds no whole year of complete months, or when that year has no high or no low. The constituents are optional and only fill gaps shorter than a day; pass the corrections they were fitted under, or the filled hours drift from the tide they model.

`observedMeanLevel(samples, constituents?, options?)` returns a gauge offset for records that cannot support an observed reduction: the mean of the complete months within the 19 years up to the record's last complete month, weighted so each calendar month counts once, or `undefined` unless all twelve calendar months are present. `prepareDatumObservations` returns the hourly series and window the observed reduction uses. Each hourly height is stamped at the start of its hour but stands for the mean instant of its samples, about :27 for 6-minute data, so fit nothing to these times.

## The datums

| Datum             | Meaning                                                                                                                                                      | Harmonic method                                     | Observed method                        |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------------- |
| **HAT / LAT**     | Highest and Lowest Astronomical Tide                                                                                                                         | highest and lowest turn of the prediction           | not computed                           |
| **HHWLT / LLWLT** | Higher High Water and Lower Low Water, Large Tide (Canada): mean of each calendar year's highest high or lowest low                                          | from the prediction, over complete calendar years   | not computed                           |
| **MHW / MLW**     | Mean High and Low Water                                                                                                                                      | mean of every high or low on complete tidal days    | mean of every tabulated high or low    |
| **MHHW / MLLW**   | Mean Higher High and Lower Low Water                                                                                                                         | mean of each complete tidal day's highest or lowest | mean of the higher highs or lower lows |
| **MSL**           | Mean Sea Level                                                                                                                                               | 0, or the `offset`                                  | mean of the hourly heights             |
| **MTL**           | Mean Tide Level, `(MHW + MLW) / 2`                                                                                                                           | derived                                             | derived                                |
| **MHWS / MLWS**   | Mean High and Low Water Springs, the Admiralty approximation `MSL ± (H_M2 + H_S2)`                                                                           | constituent amplitudes                              | not computed                           |
| **NLLW / ALLW**   | Indian Spring Low Water, `MSL − (H_M2 + H_S2 + H_K1 + H_O1)`, under Japan's (Nearly Lowest Low Water) and South Korea's (Approximate Lowest Low Water) names | constituent amplitudes                              | not computed                           |
| **TLT**           | Theoretical Lowest Tide (China), by Vladimirsky's method                                                                                                     | GB 12327-2022 Appendix J, formula J.1               | not computed                           |

HAT, LAT, HHWLT and LLWLT are defined from predictions, so the observed reduction leaves them to the harmonic one: an observed record's extremes include weather, and CHS defines the Large Tide levels from 19 years of predictions (Canadian Tidal Manual, §5.7). The amplitude datums need M2 and are left out without it. Any datum that comes out non-finite is left out of the map.

The harmonic reduction uses every turning point of the predicted tide, with the engine's prominence threshold set to zero. An amplitude cutoff would drop small daily tides while keeping seasonal and monthly turns, which biases the means toward the longer-period envelope. A prediction with no turning points throws. A tidal day is two M2 periods, about 24.84 hours, counted from the series' first turn, and the first and last days are left out because they can hide a day's higher high or lower low. MHW and MLW average every high or low, while MHHW and MLLW average one per tidal day, so the two populations need not keep their usual order on days with an unequal number of turns.

### Theoretical Lowest Tide

TLT follows GB 12327-2022, _Specifications for hydrographic survey_, Appendix J, formula J.1. It is the lowest level that M2, S2, N2, K2, K1, O1, P1, Q1, M4, MS4, M6, Sa and Ssa can reach together. It is found by sweeping K1's phase through 360° in 0.1° steps, with each other constituent's phase tied to K1's through its Greenwich phase lag. Node factors are fixed by tide type (Table J.1), not taken from the date: one set for semidiurnal areas and one for diurnal areas, and a mixed area takes the deeper of the two results. The standard names these types without bounding them. This package uses the usual Chinese classification by the form ratio `F = (H_K1 + H_O1) / H_M2`: semidiurnal when F ≤ 0.5, diurnal when F > 4, and mixed in between. Every phase combination in J.1 has zero net speed, so the result doesn't depend on the time zone the phases are referred to. TLT ignores the `nodeCorrections` option, since the standard fixes its own node factors.

## Datum epoch

The harmonic datums are predicted over a pinned epoch of 19 full calendar years, `DATUM_EPOCH`, from 2007-01-01 to 2026-01-01, following the convention of NOAA's National Tidal Datum Epoch and the Canadian Hydrographic Service.

- **Pinned, not derived from the current date.** A window anchored to the day of the run moves a little every day and wiggles HAT and LAT by centimetres between runs. A pinned epoch gives the same output for the same constants. Moving it is a deliberate change, roughly once a decade.
- **19 full calendar years, not 18.61.** The window has to hold one full lunar nodal cycle (`NODAL_CYCLE_DAYS`, 18.61 years) or HAT and LAT miss the nodal extreme, and 19 is the smallest whole number of calendar years that does. Whole years matter because a fractional window over-samples the seasons in its 0.61-year tail, biasing every mean, and because HHWLT and LLWLT average annual extremes, which is why they count complete calendar years only. Nineteen years is also close to the Metonic cycle of 235 lunar months, so spring and neap tides spread evenly across the seasons.

An explicit `end` gives the 19 years before it, with 29 February falling back to the 28th of a common year.

## Observed reduction

The observed datums follow NOAA's first reduction ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), §2.6 and §3.1) over one period of a year or more, without a control-station correction to a 19-year epoch.

1. Finite samples are averaged into UTC hourly bins, each at the mean instant of its samples. Samples that share an instant are averaged first, so a repeated row counts once.
2. With constituents, gaps of up to 23 missing hours are filled from the prediction plus the observed-minus-predicted residual, and filled hours count as inferred in `coverage`. Without constituents, or with none that is a diurnal or faster tide of nonzero amplitude, only records that are already continuous and hourly qualify.
   - Up to three missing hours, with four real bins bracketing the gap no more than four hours apart, take a cubic fitted to the residuals at the four anchors. The fit uses each anchor's actual sampling instants, so a change of cadence across the gap does not shift it, and a filled hour follows the sampling of its nearer anchor. This also resamples three-hourly records. The anchors' sampling instants must be at least half an hour apart, since nearer anchors make the cubic ill-conditioned.
   - A longer gap, or one whose anchors are too close for the cubic, takes a residual interpolated linearly between the two real bins at its edges. Each side needs two real hours in a row, so a lone reading inside an outage can't join two fills. The residual at the two edges must agree within 0.1 m; a larger change means a surge or a gauge zero shift, and the gap stays open. A month with more than 72 hours filled this way is not complete.
   - Filled hours never anchor another gap, and nothing is extrapolated, so a gap of 24 hours or more leaves its month incomplete.

   NOAA fills gaps of up to 3 to 4 hours by curve fit, and longer ones of up to 3 days from backup sensors, nearby stations or predicted tides ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), §2.6). Its station specifications allow fills longer than 3 hours only where the fill source matches the gauge and no weather event falls in the gap, and compute no monthly mean across a gap longer than 3 days ([Water Level Station Specifications, November 2013](https://tidesandcurrents.noaa.gov/publications/Water_Level_Station_Specs_for_NGS_Projects_Final_November_2013.pdf), §1.3.3 and §1.3.4). The IOC recommends filling only gaps shorter than 24 hours ([IOC Manuals and Guides 14, vol. II](https://psmsl.org/train_and_info/training/manuals/ioc_14ii.pdf), §5.1.1), which sets the 23-hour limit. TADC itself fills only gaps under 3 hours. The other bounds are this package's own: the 0.1 m residual check stands in for NOAA's matching condition, the 72-hour cap takes NOAA's 3-day gap as a month's total, and the two-hour edge rule and both interpolations are choices no agency states.

3. The window is the longest run of complete UTC calendar months that is a whole number of years, 12, 24, 36 months and so on, within the 19 years up to the record's last complete month, and the latest such run on a tie. The result's `start` and `end` give that window, with `end` exclusive, and `coverage` counts its months and its observed and inferred hours. Twelve months is this package's minimum, not a national standard.
4. High and low waters are tabulated by NOAA CO-OPS's Tidal Analysis Datum Calculator (TADC), described in NOAA Technical Report NOS CO-OPS 085 §2.2 and published by CO-OPS as [code](https://github.com/NOAA-CO-OPS/CO-OPS-Tidal-Analysis-Datum-Calculator/tree/04836aa). The hourly series is low-passed by a 6th-order Butterworth filter at 4 cycles per day, run forward and backward so it adds no phase shift, and its turning points are the candidate tides. A walk through them in time order drops a second tide of the same kind within 2 hours, and drops both of a high and low less than 2 hours or 0.03 m apart (Hicks 1980), with heights 3 cm apart kept whatever their floating-point difference. Each remaining tide's time and height come from the observations around it at the record's own cadence, filled hours included at their own instants. For a record sampled more often than every 15 minutes, the height is the extreme of a cubic fitted around the tide. The fit spans 6.5 hours where the observations within 3¼ hours range over 0.5 m, narrowing to 2.5 hours at a range of 1 m or more, and TADC fits a range under 0.5 m over 2.5 hours too. For a coarser record it is the extreme observation within 30 minutes.
5. Higher highs and lower lows are designated by TADC's rules. With more than three tides a day, each consecutive pair of highs, and of lows, gives one (EXHL). With fewer, a 25-hour step from the most extreme tide in the first 13 hours marks the most extreme tide around each step (DIUR). Each tide keeps its place in the filtered series, and where tides are close, as at a gauge with almost no tide, two can be read out of time order. DIUR then searches every tide, as TADC does.
6. Each datum is an arithmetic mean over the window, NOAA's first reduction: MHW and MLW of every high or low, MHHW and MLLW of the higher highs and lower lows, MSL of the hourly heights, and MTL `(MHW + MLW) / 2`.

This port departs from TADC in a few places. TADC filters the observations at their own interval, which needs regular sampling, where this package filters hourly bins to find the tides and then reads their heights from the observations. Its spacing check keeps a high and low exactly 3 cm apart whatever their floating-point difference. Its once-a-day designation stops where TADC's code would loop, at the last tide or on a step it has taken before, and marks nothing for a step whose window holds no tide. There TADC's code reads the missing tide as the record's last: where the step's window falls before it, it marks the last tide, and where tides out of time order leave the window empty, it marks a tide around that step and goes on from the last one. A coarse record's heights come from the ±30-minute extreme, which is TADC's other pick method, where TADC's default fits a cubic. TADC fills only gaps under 3 hours and otherwise analyzes the longest continuous segment, where this package fills gaps of up to 23 hours from the prediction and joins the segments around them.

## Nodal corrections

Every prediction, in both the harmonic and the observed paths, uses the corrections passed in, IHO's by default. The sets give different datums from the same constants. Between IHO's and Schureman's, a solar tide is unaffected and an M2 tide gives the same datums to the millimetre, but the diurnal and long-period constituents move HAT and LAT by millimetres to centimetres. Foreman's set takes the site's `latitude`, and the engine refuses Sa, S1 and OQ2 under it.

## Known limitations

- A record sampled hourly or more sparsely gives high and low waters at its own sampling, so its heights sit slightly inside the true extremes. TADC's default cubic fit over about 6.5 hours of such a record would flatten a semidiurnal peak by a few percent instead; NOAA tabulates from 6-minute data.
- TADC's cubic widens from 2.5 to 6.5 hours as the local range reaches 0.5 m, so a fine record with a range just over 0.5 m has its highs and lows flattened by about a centimetre, while one just under does not.
- An hour with a single sample counts as a complete hourly height, and the filter treats the hourly series as evenly spaced even where bins' mean instants differ.
- A coarse record's tide takes its height from one observation, so noise in that observation carries into it. A fine record's comes from a cubic fitted around the tide, as in TADC.
- The harmonic reduction designates higher highs and lower lows by tidal days of two M2 periods, counted from the first predicted turn, not by TADC's EXHL and DIUR.
- An observed reduction is a first reduction over its own window. It applies no simultaneous comparison with a control station, which NOAA uses to bring series shorter than 19 years to the National Tidal Datum Epoch.
- The tide-type bounds that choose TLT's node factors come from the usual Chinese classification, not from GB 12327-2022 itself.
- The cubic fill has no limit on how much of a record it fills, so a regular three-hourly record can qualify with most of its hours filled; `coverage` reports the split. It also has no residual check, so a gauge zero shift inside a gap of three hours or less is bridged.
- The residual check compares two single edge bins, so it can't see weather that comes and goes inside a gap, and a noisy edge bin can block a good fill or pass a bad one. Two real hours in a row end a gap, so a gauge reporting two hours a day can have every day filled, up to the monthly cap. The cap counts per calendar month, so fills either side of a month boundary can together exceed 72 hours.
- A tide inside a gap is tabulated from filled hours at hourly spacing, even in a 6-minute record.
- The package can't tell a sample a source interpolated from a measured one. A source's own fills count as observed, outside every bound above, so a caller that wants these bounds drops them first.
- Filling cannot correct a poor harmonic model, and the three decimal places of every datum are rounding, not accuracy.
- Neither method has been compared here with published results: the observed one with TADC's own output or NOAA's published datums, nor TLT with published Chinese values. The tests check the once-a-day designation's marks on a few sets of tides against a hand transcription of TADC's DIUR. The tests check TLT against an independent search over the lunar and solar angles for the eight main constituents, and against M2's low water for the shallow-water terms.

## References

- NOAA CO-OPS, [Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), NOAA Special Publication NOS CO-OPS 2, 2003.
- NOAA CO-OPS, [A Comparison of Datums Derived from CO-OPS Verified Data Products and Tidal Analysis Datum Calculator](https://tidesandcurrents.noaa.gov/publications/techrpt085.pdf), NOAA Technical Report NOS CO-OPS 085, 2017.
- S. D. Hicks, _The National Tidal Datum Convention of 1980_, NOAA National Ocean Service, 1980, for the 2-hour and 0.03 m criteria, as cited by Technical Report 085.
- M. W. Forrester, [Canadian Tidal Manual](https://waves-vagues.dfo-mpo.gc.ca/Library/40935620.pdf), Department of Fisheries and Oceans, 1983, §5.7.
- Standardization Administration of China, GB 12327-2022, _Specifications for hydrographic survey_, Appendix J.
- IHO Tidal and Water Level Working Group, [List of Vertical Datums used by IHO Member States to describe Chart Datum](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Vertical_Datums_v1.0.pdf), 2021.

## License

MIT, except the high and low water tabulation (`src/tabulate.ts`), which is ported from NOAA CO-OPS's Tidal Analysis Datum Calculator. That code is in the public domain in the United States; elsewhere the U.S. Department of Commerce grants a royalty-free, nonexclusive license to use, copy and create derivative works of it. Both notices are in [LICENSE](LICENSE).
