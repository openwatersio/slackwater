# CHS tide fit window validation

This record supports `chsTideFit`, the CHS tide fit recipe every Slackwater client uses (`@slackwater/engine`, and `ChsTideFit` in Swift and Kotlin), and the app's [CHS data model](https://github.com/openwatersio/slackwater-ios/blob/main/docs/chs-data-model.md). Measurements below come from the September 20, 2026 window sweep, the October 18 national sample, and the October 19 engine benchmark run; they are evidence for that decision, not a claim about every future fit. `benchmarks/chs-fit.ts` scores the recipe against the bar set here every month.

`chsTideFit.days` is 60. The fit window is the highest-leverage lever on first-run download time: wall clock is linear in request count, 1,058 of the 1,073 fittable CHS stations are tide ports, and the 7-day `chunkPlan` grid in the [IWLS fetching contract](../iwls-fetch.md) turns 60 days into 9 or 10 IWLS requests per port against 5 or 6 for 35 days, depending on where the fit day falls in the epoch week. At Victoria's 25 km tier that is up to 11 minutes against 7.

This pass measures whether a shorter window reproduces CHS's own published curve as faithfully as 60 days does, on the app's exact shipping path, and sets the bar before looking at any result.

## The premise that does not apply here

A shorter harmonic fit is conventionally more contaminated by weather, because a tide gauge records the meteorological residual along with the tide and a short record gives the fit less of it to average away.

**Slackwater never fits a gauge record.** [CHS data model](https://github.com/openwatersio/slackwater-ios/blob/main/docs/chs-data-model.md) §2: the app fetches `wlp` — CHS _water-level predictions_ — and gates fetch `wcsp1`/`wcdp1`, also prediction series. slackwater-ios's `ChsStation.swift` says it in the type's own doc comment: "a harmonic model fitted on this device from IWLS predictions". There is no meteorological residual in the input at any window length, so residual rejection cannot be the thing a longer window buys.

What a longer window does buy is **Rayleigh separation**. Two constituents resolve independently when the window exceeds `360 / Δspeed` hours, and for the 23-constituent `CHSConstituents.BASIS` the thresholds cluster:

| Threshold  | Pairs                                               |
| ---------- | --------------------------------------------------- |
| 365.3 d    | S2/T2                                               |
| 205.9 d    | N2/NU2, 2N2/MU2                                     |
| 182.6 d    | K1/P1, S2/K2, MSF/MF                                |
| 121.7 d    | K2/T2                                               |
| **34.8 d** | **L2/T2**                                           |
| **31.8 d** | **N2/MU2, MM/MSF, M2/NU2, S2/L2**                   |
| 27.6 d     | M2/N2, M2/L2, O1/Q1, K1/J1, MU2/NU2, N2/2N2, M4/MN4 |
| ≤ 27.1 d   | everything else                                     |

Nothing in the basis separates between 35 and 60 days. Five pairs separate between 28 and 35. **28 days is a different fit; 35, 42 and 60 days are the same fit on paper** — which is why the sweep runs all four rather than testing 35 alone, and why a synthetic noise-free measurement finding an identical unseparable set at 35 and 60 proved only what the table above already predicts.

L2/T2 at 34.8 d is the reason 35 is the shortest candidate worth the request budget. It clears by 0.2 days on paper, and in the app by more: `chunkPlan` snaps its start down to an absolute 7-day epoch grid, so a nominal 35-day plan delivers 35–42 days and never less than 35.

## Method

Harness: slackwater-ios's `tools/FitValidation`, the same tool and with the committed `chs-bundle.js` + `chs-glue.js` the app then shipped, grew a `--days` flag.

1. **Resolve by position, never by name** — nearest IWLS station serving `wlp` within 3 km of the registry position.
2. **Fetch `wlp` once per station**, 60 days ending today 00Z, decimated to the 15-minute grid the app fits on. Each shorter window is the trailing slice of that one series, so the sweep costs no extra IWLS requests — the shape `--current` mode already uses for its 210/60 pair.
3. **Fit each window in JavaScriptCore** with the app's own artifacts. The apps have fitted natively with `fit` and `chsTideFit.basis` since slackwater-ios#496, and the October sample below used that path.
4. **Predict with SlackwaterKit `Station`** — the shipping synthesis.
5. **Score against CHS's own published `wlp` and `wlp-hilo`**, held out +28..+35 days into the future: RMSE on the 15-minute grid, and extreme timing and height against `wlp-hilo`, classified high/low against neighbours and matched by kind within 180 minutes.

Ports are spread deliberately, because whatever does vary with window length will not vary uniformly: dense Salish inlets, open Atlantic coast, the Fundy extreme range, the St Lawrence river and estuary where shallow-water overtides dominate, and a sparse sub-Arctic site.

## The bar (set before scoring)

There is no written tide bar in this repo; the currents bar in [CHS current validation](chs-currents.md) is the precedent, and this one follows its shape — one clause per number a person actually reads, tightest on the quantity they act on.

Height is not slack. Nobody transits a tide port _at_ high water the way a gate is transited at slack, so the timing clauses are the engine's established maxima bar rather than the tighter safety numbers currents earned. What a skipper does act on is the height itself, for underkeel clearance.

An absolute-only height bar is wrong across this coastline. Ten centimetres is a fifth of the semidiurnal range at a small Salish port and a rounding error at Saint John, where the range is 8 m. Each height clause therefore carries a relative alternative, and the looser of the two applies.

| Quantity                     | Bar                                   | Why                                                                                                             |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Held-out RMSE, 15-min grid   | ≤ max(10 cm, 2 % of range)            | 10 cm is the granularity underkeel clearance is planned at; 2 % keeps a Fundy port from failing for being large |
| Extreme timing, median       | ≤ 20 min                              | the engine's established maxima bar (= chs-constituents "medium" tier), same number the currents bar uses       |
| Extreme timing, worst        | ≤ 40 min                              | 2× the median bar, the ratio the currents bar sets between median and worst                                     |
| Extreme height error, median | ≤ max(10 cm, 2 % of range)            | the number read off the high or low, the tide analogue of the currents peak-speed clause                        |
| Extremes matched             | every observed extreme within 180 min | an unmatched high water is a missing tide, worse than any error it could report                                 |

Range is the observed peak-to-trough of `wlp` over the held-out window, per station.

### The clause that decides the question

Passing the absolute bar is not sufficient. A shorter window ships as **final**, not provisional, so it must not be a quiet downgrade of a number already shipping at 60 days:

> At every station, the shorter window's RMSE is ≤ 1.25× the 60-day RMSE, and its extreme timing median is within 5 minutes of the 60-day median.

A window that passes the absolute bar but fails this one is a candidate for deferred refinement — publish short, refine to 60 later — not for a constant change.

PASS for a window = every absolute clause and the relative clause, at **every** station. One bad station is a failure; per-station results are reported below, not just aggregates.

## Results

Eight ports, eleven windows each, fitted and scored on 2026-09-20 against a held-out window 28–35 days out. One 60-day `wlp` fetch per port; every window is a trailing slice of it, so the whole 88-fit sweep cost 8 ports' worth of IWLS requests.

Held-out RMSE, centimetres:

| Port           | range | 28 d  | 32 d  | 35 d  | 36 d | 38 d | 40 d    | 42 d    | 44 d | 48 d     | 54 d    | 60 d |
| -------------- | ----- | ----- | ----- | ----- | ---- | ---- | ------- | ------- | ---- | -------- | ------- | ---- |
| Churchill      | 294   | 36.6  | 22.0  | 31.0  | 25.7 | 11.4 | **5.6** | 8.2     | 7.9  | 6.9      | 13.2    | 10.3 |
| Halifax        | 148   | 18.8  | 32.4  | 22.2  | 17.9 | 10.3 | 6.3     | 6.1     | 6.5  | **5.1**  | 5.3     | 5.5  |
| North Sydney   | 83    | 18.2  | 14.7  | 16.5  | 14.2 | 8.8  | 4.4     | **2.7** | 2.7  | 3.1      | 3.5     | 3.8  |
| Point Atkinson | 278   | 77.7  | 64.0  | 22.1  | 13.0 | 13.9 | 8.2     | 8.8     | 10.1 | **7.6**  | 8.2     | 9.4  |
| Rimouski       | 314   | 122.5 | 51.5  | 56.8  | 52.4 | 33.0 | 13.4    | 7.2     | 6.8  | 3.9      | **3.7** | 5.1  |
| Saint John     | 659   | 111.1 | 158.5 | 110.9 | 77.9 | 35.6 | 25.9    | 20.4    | 19.8 | **14.1** | 18.8    | 14.7 |
| Victoria       | 168   | 47.6  | 33.1  | 28.7  | 27.1 | 22.0 | 10.4    | 7.1     | 8.6  | 7.0      | **6.7** | 7.6  |
| Vieux-Québec   | 446   | 190.4 | 142.0 | 121.5 | 89.1 | 49.9 | 35.3    | 32.8    | 26.1 | **20.5** | 24.7    | 20.4 |

Stations clearing the bar, and what each window costs in IWLS requests:

| Window   | Absolute bar | Relative clause | Median RMSE | Worst RMSE | Requests |
| -------- | ------------ | --------------- | ----------- | ---------- | -------- |
| 28 d     | 0/8          | 0/8             | 77.7        | 190.4      | 4–5      |
| 32 d     | 0/8          | 0/8             | 51.5        | 158.5      | 5–6      |
| **35 d** | **0/8**      | **0/8**         | **31.0**    | **121.5**  | 5–6      |
| 36 d     | 0/8          | 0/8             | 27.1        | 89.1       | 6–7      |
| 38 d     | 0/8          | 0/8             | 22.0        | 49.9       | 6–7      |
| 40 d     | 2/8          | 3/8             | 10.4        | 35.3       | 6–7      |
| 42 d     | 4/8          | 4/8             | 8.2         | 32.8       | 6–7      |
| 44 d     | 4/8          | 3/8             | 8.6         | 26.1       | 7–8      |
| 48 d     | 4/8          | **7/8**         | 7.0         | 20.5       | 7–8      |
| 54 d     | 4/8          | 6/8             | 8.2         | 24.7       | 8–9      |
| 60 d     | 4/8          | —               | 9.4         | 20.4       | 9–10     |

### 35 days does not hold, and not by a little

At no port is a 35-day fit a mild degradation. It is 3.8× worse than 60 days at Victoria, 4.2× at Rimouski, 7.5× at Saint John, 6.0× at Vieux-Québec. A 121 cm held-out RMSE is not a fast answer with a known ceiling; it is the wrong curve.

### The cliff is at 40 days, and it is a conditioning cliff

Every port improves 2–4× between 38 and 40–42 days, and the improvement is **not monotonic** afterwards — Churchill is better at 40 d (5.6) than at 54 d (13.2) or 60 d (10.3); Halifax is worse at 32 d (32.4) than at 28 d (18.8). More data that sometimes makes the answer worse is not an information problem. It is the normal matrix.

The in-sample residual sees none of it. Victoria's fit reports 4.0 cm rms at 28 days and 4.4 cm at 60, while the held-out error between those two windows differs by a factor of six. **A short fit looks healthy from the inside and is wrong outside.** Anything that assesses fit quality from `rms` alone — including anything a future UI might show a user — is reading a number that cannot see this failure.

The mechanism is margin above a Rayleigh threshold, not distance below one. A window that clears a pair by a hair separates it nominally and then splits energy between the two constituents with large compensating amplitudes, which cancel inside the window and diverge outside it. 28 d sits 0.4 d above the 27.6 d cluster, which contains M2/N2; 35 d sits 0.2 d above L2/T2 at 34.8 d. Both report _fewer_ unseparable pairs than the window below them and score worse. The unseparable list is therefore not a safety signal: at 35 d it is identical to 60 d's, seven pairs, at every port.

### `chunkPlan`'s 7-day snap makes a short window non-deterministic

`chunkPlan` snaps its start down to an absolute 7-day epoch grid, so `chsTideFit.days = N` delivers between N and N + 7 days depending on where the fit day falls on the grid. At N = 60 that spans 60–67 days, all of it clear. At N = 35 it spans 35–42 — the cliff runs straight through it, so the same port fitted on a Tuesday and a Saturday would get materially different models. **Whatever `chsTideFit.days` becomes, its floor is the number that has to be safe, because the floor is what some users get.**

### 60 days does not clear this bar either

Four of eight ports fail the absolute bar at the window currently shipping. Two are near-misses on a single clause: Point Atkinson's timing median is 9.2 min and its RMSE 9.4 cm, failed only by one extreme 48.4 min out; Churchill fails on RMSE by 0.3 cm. Two are not near-misses — **Saint John and Vieux-Québec fail at every window tested**, at 14.7 cm and 20.4 cm held-out RMSE respectively at 60 days.

Those two are the tidal-river and extreme-range cases. That is a coverage finding, not a window finding: the window sweep cannot fix a port that the basis cannot represent. [Where 60-day fits miss](#where-60-day-fits-miss) measures how common it is.

One clause looks mis-specified in hindsight, and is reported as written rather than quietly revised: **extreme timing, worst ≤ 40 min** fails ports whose height error is small, because near a flat stand the time of the extremum is poorly determined even when the curve is right. Point Atkinson fails it at every window including 60. A revision would score timing only at extremes whose curvature exceeds some floor, the way the currents bar already skips extrema below 0.75 kn. It was not revised here because it was set before scoring.

## Verdict

**Leave `chsTideFit.days` at 60.** 35 days is unsafe by a wide margin, and the safe floor is ~48 days — 7–8 requests against 60's 9–10, a saving of roughly 20 % rather than the 40 % a 35-day window promised. That is not enough to pay for a change to the one number the whole Canadian tide path depends on, and it is well inside the margin where a port that behaves differently from these eight would be a regression nobody measured.

**Deferred refinement is not worth designing for tide ports.** It is the right machinery for a provisional answer that is _degraded_ — which is what the 60-day current gate is, badged, with a measured 20–35 min worst-case slack error. A 35-day tide fit is not degraded, it is wrong, and no badge makes a 121 cm error publishable. Raising the provisional window to the safe floor removes the reason to defer: 48 d saves two requests over 60 d, which does not pay for a retention policy on the iOS app's `ChsChunkStore`, a purge-point move, and a second fit per port.

The download-time lever is real, but it is not this constant.

## Where 60-day fits miss

Measured on 2026-10-18 with the native fitter (#427). Fits end at 00Z that day and are scored against the same bar, held out +28..+35 days unless noted.

The sample is every 18th station of `chs-stations.json` in id order plus the eight ports above, 66 in all. Montréal (rue Frontenac) and Sorel serve no `wlp-hilo` for the held-out week, so 64 were scored. The eastern Arctic is undersampled: the Iqaluit zone's 73 stations contribute one.

These numbers were measured with slackwater-ios's `tools/FitValidation` as extended in openwatersio/slackwater-ios#739 (`--days 60,67`, and `--holdout` for the later weeks), fitting with `SlackwaterKit.fit` and this basis. Its `--js` mode refit with the frozen JavaScript oracle and matched the native fitter to the printed precision at 48, 60 and 67 days at Saint John and Vieux-Québec. The miss is not a porting artefact.

`npm run benchmarks:chs-fit` measures the same thing from the engine: every Nth IWLS port serving `wlp` and `wlp-hilo` in code order, fitted with `chsTideFit` and scored at +28, +90, +180 and +270 days. It fetches its fit inputs through the [IWLS fetching contract](../iwls-fetch.md), so each port is fitted from the same at-least-60, under-67 days a device would fit, ending at the port's local midnight on the 1st of the current month. The monthly run moves through the seasons, and through the epoch grid's span of window lengths. It writes `benchmarks/chs-fit.csv`.

### Most of Canada does not clear the bar at 60 days

| Outcome at 60 d                                  | Stations |
| ------------------------------------------------ | -------: |
| Pass                                             |       27 |
| Fail on timing only                              |       11 |
| Fail a height clause, mostly a mean-level offset |       14 |
| Fail a height clause, curve shape                |       12 |

67 days, the longest window a 60-day `chunkPlan` delivers, passes 30. The ranking is the same.

All 11 timing-only failures fail the worst-timing clause. Some also fail the median or leave an extreme unmatched. Five are Arctic and Gulf ports with a 22–70 cm range: Eureka, Kugluktuk, Jenny Lind Island, Cooks Harbour and East Margaree River. The other six are Victoria, Prideaux Haven, Grande-Entrée, Shoal Cove West, Middle Cove and Cape Kater. Their height clauses pass. This is the clause [60 days does not clear this bar either](#60-days-does-not-clear-this-bar-either) already reads as mis-specified.

### The common miss is the seasonal mean level

At 14 stations, the held-out error is mostly a constant offset. The mean signed error (prediction minus CHS) carries most of the RMSE. Removing it brings RMSE under the bar:

| Station           | Range | RMSE |  Bias | RMSE without bias |
| ----------------- | ----: | ---: | ----: | ----------------: |
| Humpback Bay      |   421 | 17.2 | −17.0 |               3.0 |
| Digges Harbour    |   188 | 17.6 | −17.0 |               4.4 |
| Casey Cove        |   450 | 18.6 | −17.2 |               7.0 |
| Lax Kw'alaams     |   432 | 17.1 | −16.4 |               5.1 |
| Sulphur Passage   |   261 | 15.2 | −14.1 |               5.7 |
| Cypress Bay       |   253 | 14.5 | −14.0 |               3.6 |
| Ford Harbour      |   127 | 14.4 | −13.9 |               4.0 |
| Lowe Inlet        |   410 | 16.1 | −13.8 |               8.2 |
| Bella Bella       |   337 | 14.4 | −13.7 |               4.5 |
| Gold River        |   273 | 10.6 | −10.2 |               2.7 |
| Thurlow Point     |   300 | 10.6 |  −8.7 |               6.0 |
| Port Moody        |   351 | 11.3 |  −5.9 |               9.6 |
| Point Atkinson    |   328 | 10.8 |  −5.3 |               9.4 |
| Winchelsea Island |   336 | 10.4 |  −5.2 |               9.0 |

All values are in centimetres. These ports time their extremes well (Humpback Bay's median is 0.6 min). The curve has the right shape at the wrong mean level.

CHS's `wlp` carries the annual cycle, and the basis cannot. `chsTideFit.basis` leaves out SA and SSA because a 60-day fit cannot separate them from Z0 (183 days are needed). CHS's weekly mean level at Humpback Bay rises about 17 cm between the August weeks of the fit window and the November held-out week, and Ford Harbour's rises about as much. The weekly means also wobble a few centimetres with the fortnightly cycle. The fit learns the window's average level, and the held-out week sits above it.

A fitted model does not expire ([CHS data model](https://github.com/openwatersio/slackwater-ios/blob/main/docs/chs-data-model.md)), so the offset depends on the calendar. It swings with the season instead of growing. The same 60-day fits, scored further out (RMSE, with the bias in parentheses):

| Station        | +28 d        | +90 d        | +180 d       | +270 d       |
| -------------- | ------------ | ------------ | ------------ | ------------ |
| Humpback Bay   | 17.2 (−17.0) | 16.0 (−15.6) | 2.1 (−1.3)   | 7.4 (+7.3)   |
| Lax Kw'alaams  | 17.1 (−16.4) | 15.1 (−12.7) | 6.8 (+2.9)   | 10.7 (+8.6)  |
| Digges Harbour | 17.6 (−17.0) | 8.1 (−5.2)   | 20.7 (+20.4) | 9.0 (+8.6)   |
| Ford Harbour   | 14.4 (−13.9) | 5.4 (+1.7)   | 11.7 (+11.4) | 12.3 (+12.1) |
| Victoria       | 9.3 (−7.4)   | 14.0 (−11.6) | 6.6 (+2.1)   | 8.8 (+4.6)   |
| Halifax        | 6.4 (−5.3)   | 6.6 (−4.4)   | 3.6 (−1.0)   | 3.2 (+1.3)   |
| Rimouski       | 5.5 (−3.7)   | 4.9 (+1.1)   | 5.3 (−0.5)   | 3.9 (−1.6)   |
| Saint John     | 13.7 (−2.2)  | 28.0 (−0.6)  | 18.8 (−1.8)  | 10.0 (−3.6)  |
| Vieux-Québec   | 19.8 (−5.0)  | 33.7 (+2.6)  | 33.7 (−22.5) | 19.1 (−0.4)  |

Any single held-out week understates this. The +28-day score depends on where the fit window and the test week sit in the annual cycle, and a model read months after it was fitted can be off by 20 cm at a port that passed.

### The rest is curve shape

12 stations still miss once the bias is removed. Kemano Bay, Patterson Inlet and Cape Ball carry the seasonal offset as well, about −14 cm. The 12 are Saint John and West Dipper Harbour (Fundy), Abbotts Harbour and Little Harbour (Nova Scotia), Vieux-Québec and La Grosse Île (St Lawrence river), Indian Arm Head, Porpoise Bay, Okeover Inlet, Kemano Bay and Patterson Inlet (BC mainland inlets), and Cape Ball (Haida Gwaii).

The in-sample residual splits them. CHS predictions are noise-free, so a large in-sample rms means the basis cannot reproduce the curve even inside the window. That is the case at Vieux-Québec (15.1 cm), La Grosse Île (10.7), Indian Arm Head (9.1), Porpoise Bay (7.1) and Okeover Inlet (6.8). The others fit in-sample at 3.8–5.4 cm and miss held-out by 10–18 cm. That is the out-of-window failure [the window sweep](#the-cliff-is-at-40-days-and-it-is-a-conditioning-cliff) found, which the in-sample rms cannot see. At Saint John it reaches 28 cm at +90 days.

### The engine benchmark agrees

The `benchmarks/chs-fit.ts` run of 2026-10-19 fitted 64 IWLS ports, every 17th in code order, with the TypeScript `fit` and `chsTideFit`, from the samples the IWLS fetching contract delivers for a fit ending at each port's local midnight on 2026-10-01. On that date the epoch grid gives each port 63.1 to 63.3 days, the spread being the ports' UTC offsets; Cap-des-Rosiers (02327) served about two days fewer, the same gap a device would fit across. One port (03670) served too few samples to fit. The other 63 were scored at four holdouts:

| Holdout | Pass | Fail on height | Height miss mostly bias | Fail on timing only | RMSE p50 | RMSE p90 |
| ------- | ---: | -------------: | ----------------------: | ------------------: | -------: | -------: |
| +28 d   |   35 |             18 |                      15 |                  10 |   6.0 cm |  15.7 cm |
| +90 d   |   30 |             25 |                      16 |                   8 |   7.5 cm |  17.7 cm |
| +180 d  |   39 |              9 |                       7 |                  15 |   4.8 cm |  10.7 cm |
| +270 d  |   52 |              7 |                       5 |                   4 |   4.6 cm |   9.8 cm |

"Mostly bias" means the RMSE falls under the bar once the mean signed error is removed. The sample and season differ from the slackwater-ios sample above, and the split is the same: about half the ports pass at the first held-out week, and the seasonal mean level carries most of the height misses. The benchmark's baseline expectations come from this run. They hold the recipe to its current performance, not to the bar.
