# Subordinate stations

A subordinate tide station has no harmonic constants of its own. NOAA publishes corrections that turn a reference station's high and low waters into the subordinate's: a time correction in minutes and a height correction that is either a ratio or a fixed amount.

## Data model

Station data comes from [`@slackwater/database`](https://github.com/openwatersio/slackwater-database). A subordinate record stores its offsets and its own `chart_datum`, which is MLLW for NOAA stations, but no constituents or datums. In [`packages/database/src/stations.ts`](https://github.com/openwatersio/slackwater-database/blob/main/packages/database/src/stations.ts), `dataIndex()` resolves a subordinate to its `offsets.reference`, and the lazy `harmonic_constituents` and `datums` getters read the reference's record through it. So a subordinate predicts from its reference's constituents, and its `datums` are the reference's datums.

In the engine, `Station.offsets` (`packages/engine/src/station.ts`) holds the reference id plus an `ExtremeOffsets` object (`packages/engine/src/harmonics/prediction.ts`):

- `height.high` and `height.low` are the corrections for high and low water.
- `height.type` is `"ratio"` or `"fixed"`. When it is absent the corrections are ratios.
- `time.high` and `time.low` are minutes added to the reference's high and low water times.

A station counts as a ratio subordinate when it has a `height` object whose type isn't `"fixed"`. Offsets that only correct time leave heights unchanged, so they don't depend on any datum.

## NOAA conventions

The sources in this section were checked on 2026-10-06.

### Ratio corrections

NOAA's tide tables give subordinate heights "referred to the datum of charts". For a ratio, marked with an asterisk in Table 2, "the high waters and low waters at the reference station should be multiplied by these respective ratios", and the datum of the result "is also the datum of the largest scale chart". These quotes are from the explanation of Table 2 in [NOAA Tide Tables 2020, West Coast](https://tidesandcurrents.noaa.gov/tidetables/2020/wctt_2020_full_book.pdf), printed pages 277 and 278.

For US stations that datum is MLLW. NOAA's [tide predictions help](https://tidesandcurrents.noaa.gov/noaatidepredictionshelp.html) says subordinate heights "will be relative to Mean Lower Low Water (MLLW), the standard chart datum for the U.S. coastline". So the ratio multiplies the reference's height above MLLW, and the result is the subordinate's height above MLLW.

### Correction types in the metadata API

NOAA's metadata API has a [`tidepredoffsets` resource](https://api.tidesandcurrents.noaa.gov/mdapi/prod/) with `heightOffsetHighTide`, `heightOffsetLowTide`, `timeOffsetHighTide`, `timeOffsetLowTide` and `heightAdjustedType`. Its documentation doesn't define the type codes. `R` is a ratio and `F` is fixed: Chinook ([`9440573`](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9440573/tidepredoffsets.json)) returns `R` with 0.95 and 1.12, which matches its asterisked Table 2 row `*0.95 *1.12`.

### Fixed corrections

Table 2 prints fixed differences in feet. The API also returns feet unless the request asks for `units=metric`, and then it returns meters rounded to the centimeter. Haystack Island ([`8218362`](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8218362/tidepredoffsets.json?units=metric)) is `-0.4` in feet and `-0.12` in meters. NOAA doesn't document the default unit or the rounding; both come from what the API returns.

The database import ([`sources/noaa/import.ts`](https://github.com/openwatersio/slackwater-database/blob/main/sources/noaa/import.ts)) requests `units=metric`, maps `heightAdjustedType` to `"ratio"` or `"fixed"`, and doesn't round further. The database stores offsets as 32-bit floats, so `-0.12` reads back as about `-0.11999999`.

### Time corrections

Table 2 prints time differences as hours and minutes "to be added to or subtracted from the time of high or low water" at the reference. The API returns whole minutes: Chinook's Table 2 row reads `-0 30` and `-0 52`, and the API returns `-30` and `-52`. TypeScript `time` offsets are minutes, and Swift's `SubordinateTideStation` takes seconds.

## Datums

The harmonic sum is relative to mean sea level. `useStation` moves it into a datum by adding a constant Z0 term of `datums.MSL - datums[datum]`, and defaults to the station's chart datum when that datum is in `datums`.

A ratio doesn't commute with that constant: `r × (h + c)` isn't `r × h + c`. So `useStation` predicts a ratio subordinate like this:

1. Predict the reference in the chart datum, with Z0 set to `datums.MSL - datums[chart_datum]`, and apply the ratio to that height.
2. Add `datums[chart_datum] - datums[datum]` to every level, after the ratio.

When the requested datum is the chart datum, the shift in step 2 is exactly zero. Fixed offsets and reference stations have no ratio, so they predict directly in the requested datum with no shift, and adding a constant before or after a fixed offset gives the same answer.

Applying the ratio in the requested datum would make the tide depend on the datum. At King Salmon (`noaa/9465149`, ratios 0.17 high and 0.67 low), the high water on 2026-10-06 is 1.054 m above MLLW when computed in MLLW, and 3.368 m above MLLW when computed in MSL with the ratio applied there and converted back.

### Why the shift uses the reference's datum spacing

A subordinate's `datums` are its reference station's datums, so the reference's spacing between datums is the only spacing the station carries. The chart-datum prediction is the one NOAA's convention defines, and every other datum is that prediction moved by a constant, so all datums agree once converted.

The cost is that a non-chart datum for a subordinate is the reference's datum plane hung from the subordinate's chart datum. It isn't the subordinate's own tidal datum, and for a station whose ratios are far from 1 the two can differ by a lot. See [open questions](#open-questions).

### Missing chart datum

A ratio subordinate that has no `chart_datum`, or whose chart datum is missing from its `datums`, throws:

```
Station <id> missing chart datum, which its ratio height offsets apply to.
```

This matches the existing error for a station without MSL. Falling back would hide the problem. Applying the ratio in the requested datum returns a tide that depends on the datum, and applying it in MSL returns a tide that is wrong in every datum, with nothing to tell the caller either way.

The error also rejects cases that would come out right, such as ratios of exactly 1 and requests that name no datum. In `@slackwater/database` 1.0.0-beta.0, checked on 2026-10-06, every ratio subordinate has its chart datum and MSL in `datums`, so only a hand-built `Station` reaches this error.

## Applying the corrections

### Extremes

`getExtremesPrediction` (`packages/engine/src/harmonics/prediction.ts`) finds the reference's high and low waters in the requested window and corrects each one. A ratio multiplies the level, a fixed offset adds to it, and the time moves by `time.high` or `time.low` minutes. Because it searches the reference's window, extremes near the edges can be lost or land outside the window; see [known gaps](#known-gaps).

### Timeline

`getTimelinePrediction` keeps the reference curve's shape between extremes and rescales it to the subordinate's corrected extremes:

1. Find the reference's extremes from 36 hours before the window to 36 hours after it, so that every output time sits between two of them, even at a diurnal station.
2. Build a keyframe for each one. A keyframe holds the reference time and level, plus the subordinate time (reference time plus the time offset) and level (the corrected extreme).
3. For each output time, find the keyframes on either side of it in subordinate time and take the fraction of the way between them.
4. Map that fraction linearly onto reference time and evaluate the reference curve there.
5. Normalize that reference level between the two reference extremes, then interpolate the subordinate levels by the same fraction. When both reference extremes have the same level, use the time fraction instead.

Step 5 is why the datum shift can come last. The normalized reference level doesn't change when a constant is added to the reference, and interpolating between two levels that both moved by a constant moves the result by the same constant. `getWaterLevelAtTime` uses the timeline path, so it gets the same treatment.

## Swift parity

`SubordinateTideStation` (`swift/Sources/SlackwaterKit/Subordinate.swift`) takes a reference `Station`, high and low water time offsets in seconds, and a `HeightOffset` of `.ratio(high:low:)` or `.fixed(high:low:)`. Swift has no datum API: `Station(constituents:offset:)` takes the Z0 offset directly.

`docs/CONTRACT.md` (§ Datums) asks Swift callers to build the reference `Station` with its chart-datum offset, `datums.MSL - datums[chart_datum]`, and to add `datums[chart_datum] - datums[datum]` to the subordinate's results for any other datum. With that, `.ratio` multiplies the height above chart datum, as `useStation` does.

Swift finds extremes differently. It searches the reference with padding of the largest time offset plus an hour, filters the corrected extremes to the requested window, and sorts them.

Swift also draws a different curve between extremes: a half-cosine between neighboring corrected extremes, which is how NOAA draws a subordinate curve. Both ports pass through the same corrected extremes, but the shapes between them differ, and no parity gate compares them.

## Validation

### Datum invariance test

The `subordinate datums` tests in `packages/engine/test/station.test.ts` predict extremes and a timeline in MSL, MHHW, LAT and NAVD88, convert each level back to chart datum, and require it to match the chart-datum prediction to 1e-9 m. They cover a synthetic ratio station, a synthetic fixed station, Chinook (`noaa/9440573`) and King Salmon (`noaa/9465149`), and they check that the missing chart datum error is thrown.

### Database-wide check

`npm run benchmarks:subordinate-datums` runs [`benchmarks/subordinate-datums.ts`](../../../benchmarks/subordinate-datums.ts) after `npm run build`. For every tide subordinate in `@slackwater/database`, it predicts extremes and a 10-minute timeline for 2026-10-06 in the chart datum and in MSL, converts the MSL levels back with `datums.MSL - datums[chart_datum]`, and fails if any level differs by 1e-9 m or more.

Against `@slackwater/database` 1.0.0-beta.0 on 2026-10-06, the worst difference is 1.8e-15 m (`noaa/9455506`). With the ratio applied in the requested datum, it is 2.31 m (`noaa/9465149`, King Salmon).

### NOAA's own predictions

[`fixtures/generate/gen-subordinates.mjs`](../../../fixtures/generate/gen-subordinates.mjs) writes [`fixtures/realworld-subordinates.json`](../../../fixtures/realworld-subordinates.json). The fixture holds the reference constituents, the subordinate's offsets, and NOAA's published high and low waters for the subordinate in MLLW, for Nurse Channel (`noaa/TEC4635`, ratio) and Kamalo Harbor (`noaa/1613077`, fixed). Swift's `subordinatesMatchNOAA` requires agreement within 15 minutes and 0.15 m. `node fixtures/generate/gen-subordinates.mjs --check` fetches NOAA again and fails on drift, and `npm run fixtures:check` runs it.

The TypeScript suite also compares Content Keys (`noaa/8724307`, ratio) with NOAA's MLLW high and low waters, within 5 minutes and 4 cm. [`benchmarks/noaa.ts`](../../../benchmarks/noaa.ts) compares every NOAA tide station in the database, subordinates included, with NOAA's high and low waters in the station's chart datum.

## Known gaps

### Extremes near the window edges

TypeScript searches for reference extremes inside the requested window and then shifts their times ([#363](https://github.com/openwatersio/slackwater/issues/363)). A positive time offset can push an extreme past `end`, and an extreme just after `start` is missed when its reference extreme falls before `start`. For 2026-10-06, a window ending at midnight UTC gives `noaa/1619645` (offsets +64 and +75 minutes) a high water at 00:16 the next day, and a window starting at midnight UTC misses the extreme at 00:20 for `noaa/8218361` (+53 and +56 minutes). Swift pads its search and filters the results instead. The TypeScript timeline isn't affected, because of its 36-hour buffer.

### Opposite-sign time offsets

A positive high water offset, a negative low water offset and a short interval between the two can put the timeline keyframes out of order, and then the interpolated level stops moving ([#362](https://github.com/openwatersio/slackwater/issues/362)). TypeScript also returns extremes in reference order without re-sorting them, while Swift sorts them.

### Entries that aren't datums

`useStation` accepts any key in `datums` as a datum, and the API's datum list does too. That includes ranges and intervals such as GT, MN, DHQ, DLQ, HWI and LWI, which aren't vertical datums, so a prediction "in HWI" means nothing.

## Open questions

- Should a subordinate's non-chart datums use its own tidal datums where NOAA publishes them, instead of the reference's spacing? An MSL prediction for a subordinate would then mean the subordinate's mean sea level.
- Should `SubordinateTideStation` take a datum shift if a Swift client offers a datum choice, instead of leaving the shift to every caller?
- Should the ports agree on the curve between extremes, either NOAA's half-cosine or the proportional mapping? A subordinate timeline fixture could then join the parity gates in `docs/CONTRACT.md`.
- Should `useStation` and the API reject datum names that are ranges or intervals?
