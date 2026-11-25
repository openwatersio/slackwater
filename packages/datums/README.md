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

const { start, end, datums } = computeDatums(constituents);
// start 2007-01-01, end 2026-01-01: the pinned epoch, see below
// datums: { HAT, MHHW, MHW, MSL, MTL, MLW, MLLW, LLWLT, LAT, MHWS, MLWS, NLLW, ALLW, TLT }
```

Harmonic datums are in the constants' own frame, where mean sea level is 0. `computeDatums(constituents, epoch?, options?)` takes:

- `epoch`: `{ end }` to predict over the 19 years ending at `end` instead of the pinned epoch. The result's `start` and `end` say which period was used. Give an `end` on 1 January, or LLWLT averages two partial years with the rest.
- `options`: the engine's prediction options. Pass `nodeCorrections` (and `latitude` for Foreman's) to match the corrections the constants were fitted under, and `definitions` for constituents outside the engine's catalog.

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
  const { start, end, datums, coverage } = result;
  // datums are in the gauge's frame; coverage counts months, observed hours and inferred hours
}
```

Samples are `{ time, level }`, the same shape as the engine's predicted points, at any cadence. The result is `null` when the record holds no whole year of complete months, or when that year has no high or no low on a complete tidal day. The constituents are optional and only fill short gaps; pass the corrections they were fitted under, or the filled hours drift from the tide they model.

`observedMeanLevel(samples, constituents?, options?)` returns a gauge offset for records that cannot support an observed reduction: the mean of complete months, weighted so each calendar month counts once, or `undefined` unless all twelve calendar months are present. `prepareDatumObservations` returns the hourly series and window the observed reduction uses.

## The datums

| Datum           | Meaning                                                                                                                                                      | Harmonic method                                     | Observed method                  |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------- |
| **HAT / LAT**   | Highest and Lowest Astronomical Tide                                                                                                                         | highest and lowest turn of the prediction           | highest and lowest hourly height |
| **MHW / MLW**   | Mean High and Low Water                                                                                                                                      | mean of every high or low on complete tidal days    | the same, over hourly heights    |
| **MHHW / MLLW** | Mean Higher High and Lower Low Water                                                                                                                         | mean of each complete tidal day's highest or lowest | the same, over hourly heights    |
| **MSL**         | Mean Sea Level                                                                                                                                               | 0, the constants' frame                             | mean of the hourly heights       |
| **MTL**         | Mean Tide Level, `(MHW + MLW) / 2`                                                                                                                           | derived                                             | derived                          |
| **LLWLT**       | Lower Low Water, Large Tide (Canada): mean of each calendar year's lowest low                                                                                | from the prediction                                 | from the hourly heights          |
| **MHWS / MLWS** | Mean High and Low Water Springs, the Admiralty approximation `MSL ± (H_M2 + H_S2)`                                                                           | constituent amplitudes                              | not computed                     |
| **NLLW / ALLW** | Indian Spring Low Water, `MSL − (H_M2 + H_S2 + H_K1 + H_O1)`, under Japan's (Nearly Lowest Low Water) and South Korea's (Approximate Lowest Low Water) names | constituent amplitudes                              | not computed                     |
| **TLT**         | Theoretical Lowest Tide (China), approximated as the lowest turn of the tide predicted from the 13 constituents the Vladimirsky method uses                  | restricted prediction                               | not computed                     |

A tidal day is two M2 periods, about 24.84 hours, counted from the first point of the series; the first and last days are left out because they can hide a day's higher high or lower low. The amplitude datums need M2 and are left out without it. TLT is not the official Vladimirsky tabular calculation and has not been compared with published Chinese values, so expect it to differ from them. Any datum that comes out non-finite is left out of the map.

The harmonic reduction uses every mathematical turning point of the predicted tide, with the engine's prominence threshold set to zero, the restricted TLT prediction included. An amplitude cutoff would drop small daily tides while keeping seasonal and monthly turns, which biases the means toward the longer-period envelope. A prediction with no turning points throws; a TLT subset with none supplies no TLT. MHW and MLW average every retained high or low, while MHHW and MLLW average one per tidal day, so the two populations need not keep their usual order on days with an unequal number of turns. These reductions do not reproduce NOAA's six-minute tabulation and analyst review.

## Datum epoch

The harmonic datums are predicted over a pinned epoch of 19 full calendar years, `DATUM_EPOCH`, from 2007-01-01 to 2026-01-01, following the convention of NOAA's National Tidal Datum Epoch and the Canadian Hydrographic Service.

- **Pinned, not derived from the current date.** A window anchored to the day of the run moves a little every day and wiggles HAT and LAT by centimetres between runs. A pinned epoch gives the same output for the same constants. Moving it is a deliberate change, roughly once a decade.
- **19 full calendar years, not 18.61.** The window has to hold one full lunar nodal cycle (`NODAL_CYCLE_DAYS`, 18.61 years) or HAT and LAT miss the nodal extreme, and 19 is the smallest whole number of calendar years that does. Whole years matter because a fractional window over-samples the seasons in its 0.61-year tail, biasing every mean, and because LLWLT averages annual lowest lows: a partial year's minimum comes from fewer candidates and sits high. Nineteen years is also close to the Metonic cycle of 235 lunar months, so spring and neap tides spread evenly across the seasons.

## Observed reduction

The observed datums are a local estimate modelled on NOAA's first reduction ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), §3.1), not an equivalent of it: they average hourly heights rather than tabulated tides, over one period of as little as a year, without a control-station correction to a 19-year epoch.

1. Finite samples are averaged into UTC hourly bins, keeping the 19 years up to the last bin.
2. With constituents, up to three missing hours in a row are filled. Four real bins must bracket the gap, no more than four hours apart. The constituents supply the tide, and a cubic fitted to the observed-minus-predicted residuals at the four anchors supplies the rest. The fit uses each anchor's actual sampling instants, so a change of cadence across the gap does not shift it, and a filled hour follows the sampling of its nearer anchor. Filled hours never anchor another gap, and nothing is extrapolated. This also resamples three-hourly records. Without constituents only records that are already continuous and hourly qualify. The handbook's §2.6 describes repairing supported gaps before tabulation; these bounds and this interpolation are this package's choices.
3. The reduction takes the longest run of complete UTC calendar months that is a whole number of years, 12, 24, 36 months and so on, and the latest such run on a tie. The result's `start` and `end` give that window and `coverage` counts its months and its observed and inferred hours. Twelve months is this package's minimum, not a national standard.

Observed HAT and LAT include weather, since they are the record's extremes. Filling cannot correct an undetected shift of the gauge zero or a poor harmonic model, and the three decimal places of every datum are rounding, not accuracy.

## Nodal corrections

Every prediction, in both the harmonic and the observed paths, uses the corrections passed in, IHO's by default. The sets give different datums from the same constants. Between IHO's and Schureman's, a solar tide is unaffected and an M2 tide gives the same datums to the millimetre, but the diurnal and long-period constituents move HAT and LAT by millimetres to centimetres. Foreman's set takes the site's `latitude`, and the engine refuses Sa, S1 and OQ2 under it.

## Known limitations

These behaviors are pinned by tests so that changing any of them is a deliberate decision.

- A numeric `offset` in the harmonic options shifts the datums taken from the prediction (HAT, LAT, MHW, MHHW, MTL, MLW, MLLW, LLWLT, TLT) but not MSL or the amplitude datums, which leaves the map in two frames. Leave `offset` unset, or `false`.
- LLWLT averages each calendar year's lowest low, so an observed window or an explicit epoch that does not start in January averages the minima of two partial years, the bias the pinned epoch avoids.
- An observed result's `end` is the start of its last hour, while a harmonic result's `end` is the exclusive end of its epoch.
- An epoch given an `end` of 29 February starts on 1 March, one day short of 19 years.
- The observed window is the 19 years up to the latest sample, so one sample with a wrong, far-future time can leave the rest of the record outside the window and the result `null`.
- The engine skips constituent names it does not know, so constants made only of unknown names leave the cubic to fill gaps without a tide, and an otherwise ineligible record can qualify.
- The observed reduction counts every hourly turn as a high or a low, however small, so a ripple from weather or seiche between two tides adds a spurious high and low that pull MHW down and MLW up. NOAA's tabulation sets a minimum separation between tides; this reduction has none.
- Two equal hourly heights at the top of a tide count as two highs, and at the bottom as two lows, which weights that tide double in MHW or MLW.

## References

- NOAA CO-OPS, [Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), NOAA Special Publication NOS CO-OPS 2, 2003.
- IHO Tidal and Water Level Working Group, [List of Vertical Datums used by IHO Member States to describe Chart Datum](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Vertical_Datums_v1.0.pdf), 2021.

## License

MIT. See [LICENSE](LICENSE).
