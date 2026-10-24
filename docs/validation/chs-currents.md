# CHS current fit validation

This record supports `chsCurrentFit`, the CHS current gate fit recipe every Slackwater client uses (`chsCurrentFit` and `projectChsCurrent` in `@slackwater/engine`, `ChsCurrentFit` in Swift and Kotlin), and the gate admission and provisional-fit rules in the app's [CHS data model](https://github.com/openwatersio/slackwater-ios/blob/main/docs/chs-data-model.md). `benchmarks/chs-current-fit.ts` fits each gate as the apps do and scores held-out weeks against CHS's own published events. It records rows, not verdicts. This repository's benchmarks workflow runs it quickly on branch pushes as a regression check. Grid points are 7 to 35 days apart, so a month holds none, one or two of them. [openwatersio/chs-current-validation](https://github.com/openwatersio/chs-current-validation), the results repository, runs the full benchmark every month, scores every grid point since the newest one it has committed, pools a year of rows per gate, and publishes each gate's tier and bounds in its [releases](https://github.com/openwatersio/chs-current-validation/releases).

## Recipe

A gate is fitted from CHS's own predictions, never from a current meter record: IWLS `wcsp1` speed and `wcdp1` direction on a 15-minute grid, projected onto the flood axis from the station's IWLS metadata as speed · cos(direction − flood). The projection is linear, so fitting it is equivalent to fitting both velocity components and projecting the result. The basis is the 23 constituents of `chsTideFit`.

`chsCurrentFit.stamp` identifies the recipe. `fixtures/generate/gen-chs-current-golden.mjs` derives it from the recipe's data and what the recipe predicts for a fixed synthetic gate, so it changes when a change to the recipe, `projectChsCurrent`, `fit` or `createCurrentPredictor` moves the golden gate's predicted velocity by 1e-4 kn or more, a slack or peak by 30 seconds or more, or a peak's speed by 0.001 kn or more. Every row carries its stamp and scorer version, so the results repository can pool only rows from the same recipe scored by the same rules. A scorer bump therefore starts a new history there, seeded afresh.

Each gate fits over 60 or 210 days. Separating K1 from P1, which drive the Pacific coast's diurnal inequality, takes at least 183 days. A 210-day gate can show the fit of its trailing 60 days first, as a provisional answer, when that fit matched every slack and its measured worst slack error, rounded up to 5 minutes, is at most 45 minutes. Past 45 minutes the warning itself says not to use the answer, so the gate waits for its full fit. Which window a gate uses, and the provisional bound it quotes, are curated per gate from these measurements.

## Method

1. **Gates** are the curated CHS current stations in `@slackwater/database`, or the list in `GATES`. Each resolves by position, never by name, to the nearest IWLS station serving `wcsp1` within 3 km. Malibu Rapids has no current station of its own (its slack derives from a tide port), so it is not fitted, and its gate record gives that reason.
2. **Grid.** Grid point i's fit ends at the gate's local midnight on 2026-10-29 + 28i + 7(i mod 4) days. Staggering the fit end by whole weeks spreads every held-out age across the 27.55-day perigee cycle, which a plain 28-day grid would hold to a five-day slice of.
3. **Fetch** `wcsp1` and `wcdp1` through the IWLS fetching contract on the app's chunk plan for the longest window, newest first, boundary duplicates kept, and project them with `projectChsCurrent`. Each shorter window starts with the chunk the app's own plan for it starts with, so a fit spans the same 0 to 7 extra days the app's does.
4. **Fit** each window with `fit(samples, chsCurrentFit.basis)` and predict with `createCurrentPredictor`, the offset carried as `meanFlow`. `WINDOWS=60,210,365` adds a 365-day window that is reported only.
5. **Score** against CHS's published `wcp1-events` over held-out weeks starting 0, 28, 90, 180 and 270 days after the fit ends. Events are fetched, in requests of at most seven days, and predicted for each week and 360 minutes on either side, twice the match window, and every slack in that span takes part in pairing, so a slack just outside the week pairs with its own neighbour rather than one inside the week. CHS slacks and predicted slacks pair one to one in time order, never crossing, within 180 minutes: the most pairs, then the least total error; a CHS slack left unpaired is missed, and a predicted slack in the week left unpaired is invented. CHS publishes a weak reversal at neaps, peaking under about 0.3 kn, as a single `WEAK_AND_VARIABLE` event rather than slack, flood and slack, so each such event excuses one pair of consecutive unpaired predicted slacks: the nearest pair whose slacks are each within 180 minutes of it and whose own reversal between them is weak too, with a predicted peak and every peak under 0.75 kn. CHS's event need not fall at the lull's centre, so the pair can lie around the event or on either side of it. Events take their pairs in time order. Two events can reach the same pair only when they are within 360 minutes of each other. At the eight gates with invented slacks in the first results release, consecutive CHS weak events are at least ten hours apart, so there neither the order nor the week a pair is scored from changed a count. Nothing checks this for new gates or seasons. Each CHS extremum of at least 0.75 kn is matched to the nearest predicted extremum of the same kind within 180 minutes, and the model's sign at every CHS extremum tests for a reversed axis.
6. **Horizon.** CHS publishes events a calendar year at a time, and each run probes how far a station's published events reach, weak-and-variable events included; a later year that IWLS refuses counts as unpublished. A week whose end, with its 360 minutes of pairing context, passes it is recorded as beyond the horizon; a week with no published slack or extremum is recorded as having none, even if it has a weak-and-variable event.

Each row records the gate, its IWLS station and flood axis, the stamp, the scorer version, the grid point, the fit's span and residual, the held-out age, each slack's error in CHS event order, and the error of each significant extremum matched within 180 minutes, as bare numbers with no CHS timestamps. A gate record carries the station's time zone, horizon, a hash of one fixed past week of `wcsp1` that changes if CHS revises its predictions (left out, with the gate's rows kept, when IWLS refuses that week), a reason for any gate with no rows at all, a gate that is not fitted included, and a failure for each grid point, or window of one, that IWLS could not serve or that would not fit, while the gate's other rows still land. A transient IWLS failure ends the run rather than leaving a gate out. `FAST=1` scores three gates at +28 days. `NO_FLOORS=1` skips the share and p50 assertions below, but still checks for reversed axes and requires scored rows for every grid point, window and held-out week not wholly beyond the horizon, the report-only 365-day window included, and at least one scored row in the run whatever the horizon. `ROWS_ONLY=1`, which openwatersio/chs-current-validation sets, also skips the reversed-axis check and every check that something scored. That repository scores gates in shards as small as one gate, where a gate's reason can stand in for all its rows. It checks across every shard that each grid point, recipe window and held-out week not wholly beyond the horizon scored a gate and that no two gates resolve to the same IWLS station, and it records a reversed axis as that gate's disqualifier. A `ROWS_ONLY` run still fails when two of its own gates resolve to the same IWLS station.

## The bar (set before scoring)

Slack is the quantity a skipper acts on, because a gate is transited at slack, so it gets the tightest numbers.

| Quantity                                          | Bar                                                          | Why                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Slack timing median                               | ≤ 15 min                                                     | tighter than the engine's ±20-minute maxima bar; a wrong slack is wrong water under a trusted name            |
| Slack timing worst                                | ≤ 30 min                                                     | 2× the median bar                                                                                             |
| Extremum timing median, published speed ≥ 0.75 kn | ≤ 20 min                                                     | the engine's established maxima bar (the chs-constituents "medium" tier); the peak of a weaker drift is noise |
| Peak speed median error                           | ≤ 0.5 kn                                                     | the number read off the peak                                                                                  |
| Slacks matched                                    | every observed slack within 180 min                          | an unmatched slack is worse than any error it could report                                                    |
| Axis                                              | model velocity has the wrong sign at < 60 % of CHS's extrema | systematic disagreement means a reversed flood axis                                                           |

A passing week meets every clause and has no missed or invented slack. A week with nothing to score fails. The share floors below hold single weeks to this bar; the results repository applies the year-round tiers, and its [releases](https://github.com/openwatersio/chs-current-validation/releases) publish them.

## Results

The tables below score single held-out weeks with fits ending at 00:00 UTC on exactly 60 or 210 days of samples, under scorer version 1, which matched each CHS slack to its nearest predicted slack. openwatersio/chs-current-validation publishes year-round results under the current scorer in its [releases](https://github.com/openwatersio/chs-current-validation/releases). The current benchmark fits on the app's chunk plan and scores under a later scorer version, so it does not regenerate these tables.

The July 31 run reproduced the validation record behind the gates slackwater-ios ships, which `tools/FitValidation` measured through the frozen JavaScript fitter: every Salish Sea gate's slack, extremum and speed numbers agreed to the precision that record kept (0.1 minute, 0.01 knots) at both windows. The national gates were recorded from a fit ending August 15 and were not compared. Under scorer version 1, this benchmark and `tools/FitValidation` were the same measurement.

The October 1 run, one season later, gives different verdicts for gates that sit near the bar. At +28 d, Blackney Passage misses worst slack (41 minutes) and Hole in the Wall misses extremum timing (23 minutes) at 210 days, while Johnstone Strait - Central and Great Bras d'Or pass only at 210 days. Dodd Narrows, Weynton Passage, Quatsino Narrows and Masset Sound pass at 60 days. Across the four held-out weeks, Hole in the Wall passes at 210 days in two of four, and only Active Pass, First Narrows and Seymour Narrows pass every week at both windows. No fit reverses its axis.

A gate's verdict near the bar is a property of the season it was measured in as much as of the gate. A gate's window and bounds are therefore judged on a year of held-out weeks, which openwatersio/chs-current-validation pools from this benchmark's rows and publishes in its [releases](https://github.com/openwatersio/chs-current-validation/releases).

Unless `ROWS_ONLY` is set, the benchmark asserts for every grid point, held-out week and recipe window (60 and 210 days) that no axis reverses. A reversed axis keeps its slack times, so only this check sees it. Unless `NO_FLOORS` or `ROWS_ONLY` is set, it also asserts that at least 30 % of the gates pass at 210 days (5 %, so at least 2 gates, at 60 days), and that the median gate's slack median is under 15 minutes at 210 days (20 at 60). The share is of every gate the run was given except the ones not fitted, so a gate with no row for a reason or a failure counts as a miss. The share and p50 floors were set from the October 1 run under scorer version 1, at least one gate below its worst week (3 of 23 at 60 days, 10 of 23 at 210), to move toward the bar as the recipe improves. openwatersio/slackwater#437 tracks recalibrating them, and until then the benchmarks workflow's quick run sets `NO_FLOORS`.

### Fit ending July 31, held out +28 d

| Gate                       | Window | fit rms (kn) | slack med / worst (min) | extrema med (min) | speed med (kn) | Verdict                                |
| -------------------------- | ------ | ------------ | ----------------------- | ----------------- | -------------- | -------------------------------------- |
| Active Pass                | 60 d   | 0.05         | 1.8 / 3.2               | 0.7               | 0.05           | **PASS**                               |
| Active Pass                | 210 d  | 0.05         | 2.4 / 4.0               | 1.1               | 0.06           | **PASS**                               |
| Arran Rapids               | 60 d   | 0.54         | 11.6 / 20.8             | 21.5              | 1.32           | extrema, speed                         |
| Arran Rapids               | 210 d  | 0.63         | 4.9 / 11.4              | 14.5              | 0.66           | speed                                  |
| Beazley Passage            | 60 d   | 0.44         | 9.9 / 16.9              | 21.2              | 1.20           | extrema, speed                         |
| Beazley Passage            | 210 d  | 0.53         | 3.6 / 10.5              | 16.2              | 0.51           | speed                                  |
| Blackney Passage           | 60 d   | 0.15         | 7.2 / 31.8              | 11.0              | 0.07           | slack                                  |
| Blackney Passage           | 210 d  | 0.16         | 5.0 / 24.7              | 8.7               | 0.07           | **PASS**                               |
| Dent Rapids                | 60 d   | 0.38         | 11.4 / 19.1             | 16.4              | 0.77           | speed                                  |
| Dent Rapids                | 210 d  | 0.46         | 3.2 / 8.6               | 20.1              | 0.27           | extrema                                |
| Dodd Narrows               | 60 d   | 0.35         | 15.1 / 32.9             | 22.8              | 0.42           | slack, extrema                         |
| Dodd Narrows               | 210 d  | 0.37         | 2.1 / 18.6              | 13.1              | 0.16           | **PASS**                               |
| First Narrows              | 60 d   | 0.06         | 2.7 / 4.8               | 1.4               | 0.07           | **PASS**                               |
| First Narrows              | 210 d  | 0.06         | 2.8 / 5.8               | 1.9               | 0.09           | **PASS**                               |
| Gabriola Passage           | 60 d   | 0.35         | 12.7 / 54.2             | 9.7               | 0.66           | slack, speed                           |
| Gabriola Passage           | 210 d  | 0.39         | 19.2 / 33.1             | 14.9              | 0.22           | slack                                  |
| Gillard Passage            | 60 d   | 0.33         | 12.4 / 17.7             | 17.5              | 0.92           | speed                                  |
| Gillard Passage            | 210 d  | 0.39         | 3.7 / 9.1               | 12.4              | 0.42           | **PASS**                               |
| Great Bras d'Or            | 60 d   | 0.20         | 6.2 / 20.5              | 8.0               | 0.20           | **PASS**                               |
| Great Bras d'Or            | 210 d  | 0.22         | 3.8 / 14.5              | 10.7              | 0.14           | **PASS**                               |
| Hole in the Wall           | 60 d   | 0.46         | 10.5 / 19.7             | 18.7              | 1.14           | speed                                  |
| Hole in the Wall           | 210 d  | 0.54         | 3.6 / 9.6               | 13.7              | 0.42           | **PASS**                               |
| Johnstone Strait - Central | 60 d   | 0.04         | 3.8 / 11.4              | 5.3               | 0.03           | **PASS**                               |
| Johnstone Strait - Central | 210 d  | 0.04         | 1.3 / 5.5               | 4.5               | 0.05           | **PASS**                               |
| Juan de Fuca - East        | 60 d   | 0.12         | 24.9 / 146.6            | 37.9              | 0.23           | slack, extrema                         |
| Juan de Fuca - East        | 210 d  | 0.22         | 18.1 / 84.5             | 22.6              | 0.11           | slack, extrema                         |
| Masset Sound               | 60 d   | 0.37         | 7.5 / 17.5              | 16.4              | 0.23           | **PASS**                               |
| Masset Sound               | 210 d  | 0.36         | 5.1 / 13.3              | 18.6              | 0.18           | **PASS**                               |
| Nakwakto Rapids            | 60 d   | 0.72         | 17.6 / 25.2             | 16.9              | 0.68           | slack, speed                           |
| Nakwakto Rapids            | 210 d  | 0.73         | 4.8 / 13.8              | 11.4              | 0.42           | **PASS**                               |
| Porlier Pass               | 60 d   | 0.35         | 12.3 / 32.0             | 18.1              | 0.28           | slack                                  |
| Porlier Pass               | 210 d  | 0.38         | 2.4 / 18.9              | 10.7              | 0.15           | **PASS**                               |
| Quatsino Narrows           | 60 d   | 0.34         | 6.7 / 24.3              | 22.6              | 0.18           | extrema                                |
| Quatsino Narrows           | 210 d  | 0.34         | 2.2 / 9.8               | 16.3              | 0.25           | **PASS**                               |
| Race Passage               | 60 d   | 0.25         | 7.8 / 28.5              | 15.0              | 0.52           | speed                                  |
| Race Passage               | 210 d  | 0.32         | 4.2 / 11.6              | 9.9               | 0.44           | **PASS**                               |
| Sechelt Rapids             | 60 d   | 1.28         | 27.8 / 60.4             | 25.5              | 1.29           | unmatched slack, slack, extrema, speed |
| Sechelt Rapids             | 210 d  | 1.29         | 15.5 / 39.5             | 11.7              | 0.94           | slack, speed                           |
| Second Narrows             | 60 d   | 0.32         | 19.2 / 45.6             | 39.7              | 0.51           | slack, extrema, speed                  |
| Second Narrows             | 210 d  | 0.35         | 5.9 / 13.5              | 20.6              | 0.26           | extrema                                |
| Seymour Narrows            | 60 d   | 0.00         | 0.2 / 1.0               | 0.3               | 0.00           | **PASS**                               |
| Seymour Narrows            | 210 d  | 0.00         | 0.2 / 0.9               | 0.3               | 0.00           | **PASS**                               |
| Tillicum Bridge            | 60 d   | 0.41         | 33.3 / 79.4             | 12.7              | 0.27           | slack                                  |
| Tillicum Bridge            | 210 d  | 0.43         | 19.0 / 93.0             | 19.1              | 0.15           | slack                                  |
| Weynton Passage            | 60 d   | 0.21         | 2.9 / 34.1              | 5.4               | 0.26           | slack                                  |
| Weynton Passage            | 210 d  | 0.21         | 3.0 / 19.2              | 5.6               | 0.12           | **PASS**                               |

### Fit ending October 1, held out +28 d

| Gate                       | Window | fit rms (kn) | slack med / worst (min) | extrema med (min) | speed med (kn) | Verdict                         |
| -------------------------- | ------ | ------------ | ----------------------- | ----------------- | -------------- | ------------------------------- |
| Active Pass                | 60 d   | 0.05         | 1.5 / 5.7               | 0.8               | 0.05           | **PASS**                        |
| Active Pass                | 210 d  | 0.05         | 1.8 / 5.9               | 0.9               | 0.04           | **PASS**                        |
| Arran Rapids               | 60 d   | 0.65         | 5.9 / 24.8              | 17.3              | 0.79           | speed                           |
| Arran Rapids               | 210 d  | 0.63         | 2.3 / 13.6              | 22.5              | 0.53           | extrema, speed                  |
| Beazley Passage            | 60 d   | 0.55         | 6.8 / 31.1              | 20.0              | 0.74           | slack, extrema, speed           |
| Beazley Passage            | 210 d  | 0.53         | 3.4 / 15.5              | 24.1              | 0.43           | extrema                         |
| Blackney Passage           | 60 d   | 0.14         | 10.1 / 47.1             | 10.8              | 0.16           | slack                           |
| Blackney Passage           | 210 d  | 0.15         | 7.5 / 41.5              | 12.4              | 0.11           | slack                           |
| Dent Rapids                | 60 d   | 0.46         | 5.4 / 21.3              | 18.7              | 0.58           | speed                           |
| Dent Rapids                | 210 d  | 0.45         | 2.4 / 12.0              | 21.8              | 0.33           | extrema                         |
| Dodd Narrows               | 60 d   | 0.35         | 6.2 / 22.2              | 13.6              | 0.44           | **PASS**                        |
| Dodd Narrows               | 210 d  | 0.37         | 5.8 / 18.8              | 12.3              | 0.34           | **PASS**                        |
| First Narrows              | 60 d   | 0.06         | 2.4 / 7.8               | 1.3               | 0.06           | **PASS**                        |
| First Narrows              | 210 d  | 0.06         | 1.6 / 8.4               | 1.4               | 0.04           | **PASS**                        |
| Gabriola Passage           | 60 d   | 0.38         | 12.9 / 33.6             | 11.0              | 0.88           | slack, speed                    |
| Gabriola Passage           | 210 d  | 0.48         | 10.5 / 17.9             | 14.3              | 0.51           | speed                           |
| Gillard Passage            | 60 d   | 0.40         | 6.7 / 24.8              | 11.3              | 0.66           | speed                           |
| Gillard Passage            | 210 d  | 0.40         | 3.2 / 10.9              | 14.5              | 0.37           | **PASS**                        |
| Great Bras d'Or            | 60 d   | 0.18         | 17.2 / 36.5             | 22.6              | 0.26           | slack, extrema                  |
| Great Bras d'Or            | 210 d  | 0.22         | 7.5 / 18.3              | 8.8               | 0.15           | **PASS**                        |
| Hole in the Wall           | 60 d   | 0.57         | 6.6 / 30.7              | 20.4              | 0.65           | slack, extrema, speed           |
| Hole in the Wall           | 210 d  | 0.55         | 3.3 / 16.3              | 23.4              | 0.40           | extrema                         |
| Johnstone Strait - Central | 60 d   | 0.04         | 9.4 / 11.6              | 25.5              | 0.03           | extrema                         |
| Johnstone Strait - Central | 210 d  | 0.04         | 3.5 / 5.2               | 13.3              | 0.03           | **PASS**                        |
| Juan de Fuca - East        | 60 d   | 0.15         | 13.4 / 144.2            | 19.4              | 0.13           | slack                           |
| Juan de Fuca - East        | 210 d  | 0.22         | 20.9 / 45.8             | 24.3              | 0.19           | unmatched slack, slack, extrema |
| Masset Sound               | 60 d   | 0.32         | 11.2 / 21.9             | 17.2              | 0.28           | **PASS**                        |
| Masset Sound               | 210 d  | 0.34         | 10.3 / 20.2             | 18.4              | 0.21           | **PASS**                        |
| Nakwakto Rapids            | 60 d   | 0.71         | 3.3 / 19.0              | 16.8              | 0.54           | speed                           |
| Nakwakto Rapids            | 210 d  | 0.72         | 5.6 / 10.5              | 13.4              | 0.66           | speed                           |
| Porlier Pass               | 60 d   | 0.35         | 8.8 / 34.8              | 15.3              | 0.33           | slack                           |
| Porlier Pass               | 210 d  | 0.38         | 8.3 / 22.0              | 13.1              | 0.18           | **PASS**                        |
| Quatsino Narrows           | 60 d   | 0.34         | 7.5 / 20.6              | 16.7              | 0.18           | **PASS**                        |
| Quatsino Narrows           | 210 d  | 0.34         | 5.0 / 15.4              | 19.4              | 0.29           | **PASS**                        |
| Race Passage               | 60 d   | 0.23         | 13.9 / 34.8             | 19.8              | 0.47           | slack                           |
| Race Passage               | 210 d  | 0.31         | 11.9 / 23.3             | 15.1              | 0.25           | **PASS**                        |
| Sechelt Rapids             | 60 d   | 1.06         | 19.1 / 47.0             | 30.3              | 0.72           | slack, extrema, speed           |
| Sechelt Rapids             | 210 d  | 1.27         | 14.4 / 31.3             | 20.7              | 0.41           | slack, extrema                  |
| Second Narrows             | 60 d   | 0.34         | 4.3 / 46.4              | 26.2              | 0.35           | slack, extrema                  |
| Second Narrows             | 210 d  | 0.35         | 8.0 / 25.6              | 21.3              | 0.19           | extrema                         |
| Seymour Narrows            | 60 d   | 0.00         | 0.2 / 0.5               | 0.2               | 0.00           | **PASS**                        |
| Seymour Narrows            | 210 d  | 0.00         | 0.2 / 0.6               | 0.2               | 0.00           | **PASS**                        |
| Tillicum Bridge            | 60 d   | 0.34         | 17.2 / 152.3            | 36.8              | 0.41           | slack, extrema                  |
| Tillicum Bridge            | 210 d  | 0.41         | 14.9 / 86.4             | 23.0              | 0.32           | slack, extrema                  |
| Weynton Passage            | 60 d   | 0.18         | 14.0 / 28.5             | 8.4               | 0.11           | **PASS**                        |
| Weynton Passage            | 210 d  | 0.20         | 8.4 / 23.3              | 5.2               | 0.14           | **PASS**                        |

### Fit ending October 1, every held-out week

✓ passes the whole bar; · does not.

| Gate                       | 60 d: +28 +90 +180 +270 | 210 d: +28 +90 +180 +270 |
| -------------------------- | ----------------------- | ------------------------ |
| Active Pass                | ✓ ✓ ✓ ✓                 | ✓ ✓ ✓ ✓                  |
| Arran Rapids               | · · · ·                 | · ✓ · ✓                  |
| Beazley Passage            | · · · ·                 | · ✓ · ✓                  |
| Blackney Passage           | · ✓ · ✓                 | · ✓ ✓ ✓                  |
| Dent Rapids                | · · · ·                 | · ✓ · ✓                  |
| Dodd Narrows               | ✓ ✓ · ✓                 | ✓ ✓ · ✓                  |
| First Narrows              | ✓ ✓ ✓ ✓                 | ✓ ✓ ✓ ✓                  |
| Gabriola Passage           | · · · ·                 | · ✓ ✓ ✓                  |
| Gillard Passage            | · · · ✓                 | ✓ ✓ · ✓                  |
| Great Bras d'Or            | · · · ✓                 | ✓ ✓ · ✓                  |
| Hole in the Wall           | · · · ·                 | · ✓ · ✓                  |
| Johnstone Strait - Central | · · · ·                 | ✓ · ✓ ✓                  |
| Juan de Fuca - East        | · · · ·                 | · · ✓ ·                  |
| Masset Sound               | ✓ ✓ · ✓                 | ✓ ✓ ✓ ✓                  |
| Nakwakto Rapids            | · · · ·                 | · ✓ · ✓                  |
| Porlier Pass               | · · · ✓                 | ✓ ✓ · ✓                  |
| Quatsino Narrows           | ✓ · · ·                 | ✓ · · ✓                  |
| Race Passage               | · · · ✓                 | ✓ · ✓ ✓                  |
| Sechelt Rapids             | · · · ·                 | · · · ·                  |
| Second Narrows             | · · · ·                 | · · · ·                  |
| Seymour Narrows            | ✓ ✓ ✓ ✓                 | ✓ ✓ ✓ ✓                  |
| Tillicum Bridge            | · · · ·                 | · · · ·                  |
| Weynton Passage            | ✓ · · ✓                 | ✓ ✓ ✓ ✓                  |

| Window | +28 d    | +90 d    | +180 d   | +270 d   |
| ------ | -------- | -------- | -------- | -------- |
| 60 d   | 7 of 23  | 6 of 23  | 3 of 23  | 11 of 23 |
| 210 d  | 12 of 23 | 16 of 23 | 10 of 23 | 19 of 23 |

## Reproduction

    npm run build && npm run chs-current-fit

The run writes `benchmarks/chs-current-fit.jsonl` (one row per gate, grid point, window and held-out week), `benchmarks/chs-current-gates.jsonl` (one record per gate) and `benchmarks/chs-current-fit.csv` (a one-week summary of each row). `GRID=-13..-1` or `GRID=-2,-1` scores those grid points, and `FIT_END=YYYY-MM-DD` the grid point whose fit ends that day; neither scores the newest grid point on or before today. The results repository passes `GRID` for every grid point since the newest one in its history, so a month it misses is scored on its next run. `chs-current-grid.ts` defines the grid. IWLS responses are cached in `.test-cache/`, keyed with both chunk ends. Events are cached as parsed, so their key also carries the scorer version, and a new scorer fetches them again. One grid point costs about 1,600 IWLS requests, paced 2.5 seconds apart.

The run fails if two gates resolve to the same IWLS station.
