The offline comparison tools prepare the five fixed methods in [#402](https://github.com/openwatersio/slackwater/issues/402). Policy `etss-comparison-inputs-2026-10-15-v1` supplies the observation, support, revision and truth rules left open by protocol v1.1. These are research choices made before the November calibration cohort. They do not establish shipping quality thresholds or expiry under #396.

## Observation selection

`observations.py` checks the original body hash and length, station identity, request URL, explicit request interval, metric units, MLLW, GMT and the ordered receipt clocks. A sample cannot follow its receipt. Responses must have strictly increasing six-minute timestamps within the requested interval. Invalid responses are disclosed and excluded. Raw bodies are never rewritten.

Policy `coops-exact-hour-research-2026-10-15-v1` selects the exact-hour row, with no averaging, interpolation, nearest-neighbor substitution or rounding. Heights and sigma must be finite; sigma must be nonnegative. Quality must be `p` or `v`. All three flat/rate/limit bits must be zero. The first flag is a nonnegative outlier count for preliminary rows and a binary inference flag for verified rows; inferred verified rows are rejected. These meanings follow [NOAA's response documentation](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html).

Preliminary sigma and outlier counts have no additional upper cutoff in this research policy. NOAA's supplied quality flags determine rejection; inventing a magnitude cutoff could selectively remove storm conditions. Every selected row retains its original fields, sigma, count, quality, manifest/body hashes and receipt time. This is an explicit research choice, not a claim that every preliminary row is accurate. Revisions and later verified data can inform separate sensitivity work; do not tune this policy using confirmation errors.

For each hour, select the latest valid receipt at or before the applicable cutoff, breaking equal receipt times with the lexicographically smallest manifest filename. A later invalid revision does not displace an earlier valid one, matching v1.1's latest-valid rule. Missing or rejected hours remain gaps. Receipt diagnostics retain accepted/rejected counts and excluded receipts.

## Decision inputs and comparators

Decisions are at 02:00 UTC. The 96 history slots span decision minus 96 hours through decision minus one hour, inclusive. Only bodies fully received by the decision qualify. All residuals subtract the frozen Slackwater prediction at that exact hour. The expected latest slot must be present for persistence; there is no search backward for a stale substitute. This support rule is not an empirical delivery or expiry guarantee.

The requested forecast is the preceding day's 18Z cycle. Choose the earliest complete, hash-verified pair fully received by the decision, then validate its CSV mapping for the station. Break ties with the smallest manifest filename. An unexplained mapping in that selected pair causes fallback, even if a later revision maps successfully. Do not substitute an older cycle. Pair receipts remain separate; the later of the two completion times controls eligibility.

For horizons 3, 6, 12 and 24 hours:

- `unchanged`: frozen Slackwater tide at the target.
- `fullTwl`: selected CSV TWL at its explicit target TIME, converted by exactly 0.3048 meters per foot. Do not add a residual, tide or BIAS.
- `mean24`: target tide plus the mean of all 24 consecutive residual slots ending at decision minus one hour. Any missing slot causes fallback.
- `persistence`: target tide plus the residual at decision minus one hour.
- `surgeChange`: target tide plus the fixed three-hour detided anchor and issued SURGE change described below.

Each unavailable method falls back to unchanged tide with a reason. Missing harmonic predictions invalidate the preparation, since an unchanged-tide baseline cannot be fabricated. Targets carry truth and missing-truth reasons independently; one missing horizon never removes another.

The detided anchor uses the existing research formula: at least 87 valid residuals among 96 slots, with a complete latest six. Fit an intercept and sine/cosine pairs with periods 23.93447, 25.81934, 12.42060 and 12 hours, using hours -95 through 0. Remove only fitted periodic components and average the latest three residuals. The implementation uses reorthogonalized QR; numerical agreement with the original least-squares probe is checked separately.

SURGE change is the centered 13-hour mean at C+8+h minus the centered mean at C+7. Require complete issued C+0 through C+96 hourly SURGE support. This implementation uses explicit CSV SURGE timestamps and meter conversion. Its formula matches the prior comparator, but CSV's millifoot precision differs from the historical decifoot bulletin. Preserve that source distinction; do not pool the historical and prospective exports as one product stratum. BIAS and post-decision observations never enter this comparator.

## Truth vintage

Research truth is the latest valid observation receipt at or before **sample time plus 24 hours**, with the same normalization and tie rule. Both preliminary and verified samples qualify; preserve which was selected. A truth snapshot taken before that deadline reports `truth_not_mature`. After the deadline, an absent eligible observation reports `no_valid_truth_receipt`. Later verified revisions may supply a separately labeled sensitivity comparison, never replace the pinned primary truth silently.

The 24-hour window is a reproducibility choice, not an estimate of provider finality. It fits the rolling 120-hour capture and the frozen calendar: the final calibration target is December 1 at 02:00 UTC; its Godin label needs observations through December 2 at 13:00, whose truth cutoff is December 3 at 13:00, before December 4 confirmation begins. Diagnostic rapid labels must use this same per-sample truth-vintage rule and complete 71-hour support. The preparation command does not compute those labels, scores, uncertainty widths or acceptance decisions.

## Frozen tide inputs

`fixtures/prediction-inputs.json` retains the three gauges' constituents and MSL-to-MLLW offsets used by the development replay, with IHO node corrections. Its SHA-256 is `5ef1a7d9e3d0f3a65abb60e4e70e9223a346ce321c547471f5cd9fa05f942b2f`.

Preparation requires a caller-pinned SHA-256 for the tide bundle. The bundle contains `schemaVersion: 1`, `datum: "MLLW"`, `units: "meters"`, `nodeCorrections: "iho"`, a nonempty `provenance` object, and `stations` mapping gauge IDs to exact-hour UTC ISO timestamps and finite numeric heights. Generate heights with `createTidePredictor(constituents, { offset, nodeCorrections: "iho" }).getWaterLevelAtTime({ time }).level`. Preserve the original input, engine source/build and lockfile hashes with the bundle. Hash verification proves identity, not that an arbitrary caller-supplied bundle came from this predictor.

The local October 15 development bundle covers October 9, 2026 through February 4, 2027 at hourly cadence, inclusive. Its SHA-256 is `3508af952e2ccfda7f191dadf3e6ee834774640cc73216ee702f4fd99e01fdef`; the engine bundle SHA-256 is `05ae56bfa6c880077a4d3db9a7bbdacd6d027231566e4819dd5740cb5a3f7213`. The saved bundle includes per-source-file hashes and the lockfile hash. Keep those artifacts with the derived reports in ignored research storage. [evaluation-pin.json](evaluation-pin.json) records the code and input hashes for this policy; every preparation also records hashes of the normalization, comparator and reader code it ran. Review any mismatch before pooling runs.

The frozen v1.1 cohort, acceptance criteria and uncertainty rules remain in #402. Shipping consumers, automatic retries/caching, numeric expiry, Kotlin parity and corrected display remain separate work.
