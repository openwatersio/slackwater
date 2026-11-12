# Currents Validation Report — Neaps

**Date:** 2026-07-18 · **Result: VALIDATED** ✅

Can the engine predict US tidal **currents** — slack, max flood, max ebb — offline, matching
NOAA's own current predictions? Yes. Constituents come straight from NOAA CO-OPS `harcon`
(public domain); nothing from XTide. All checks run offline via `swift test` against bundled
fixtures captured from NOAA.

## What the numbers were measured against

`fixtures/currents-sample.json` — NOAA CO-OPS stations
(`harcon.json` at each station's `currbin`, plus `currentpredictionoffsets.json`), sampled
from an [noaa-current-stations](https://github.com/openwatersio/noaa-current-stations)
release:

- **8 harmonic** stations (own constituents) + **139 subordinate** stations (offset
  reduction against a reference). 0 unresolvable references.

The engine ships no station data. A caller supplies constants; the sample exists so the
subordinate tests can drive many stations at once.

## Engine correctness — structural

A current station is the same sum-of-cosines as a tide station; the result is signed
major-axis velocity (knots). Extrema reuse the validated tide extremes finder
(slope-zeros); sign and high/low distinguish maximum flood/ebb from same-sign
minimum flood/ebb. NOAA max_slack observations are matched by signed phase. Slack is the one
new primitive — the velocity **value**-zero — checked against an analytic single-M2 current.

## Real-world accuracy — vs NOAA's own current predictions

Each station: feed the engine NOAA's published constituents, predict slack/max events,
compare to NOAA's own `currents_predictions` for the same station and days. Tolerances are
real-world (subordinate is a table approximation): harmonic ±20 min / ±0.35 kn, subordinate
±30 min / ±0.4 kn.

| Check | Station(s) | Result |
|-------|-----------|--------|
| Harmonic oracle | PUG1741 Bellingham Channel (2.8 kn reversing) | **9.7 min / 0.055 kn** (11 events) |
| Subordinate reduction | PCT0236 (ref SFB1201) | **6.1 min / 0.05 kn** (11 events) |
| Subordinate batch | 9 pure subordinates (regions, offset signs, ratios 0.2–1.5) | worst **7.7 min / 0.101 kn** |
| **Home passes (direct)** | Deception Pass, Rosario, San Juan Channel, Turn Point, Admiralty, Race Rocks | worst **15.3 min / 0.28 kn** |

Home passes, per station (significant currents): Deception Pass 14.2 min · Rosario 2.2 ·
San Juan Channel 8.4 · Turn Point/Boundary 15.3 · Admiralty Inlet 3.5 · Race Rocks 6.0.

On par with the tide engine's 7.9 min. **The phase convention is confirmed `majorPhaseGMT`**
(the head-to-head timing match resolves it).

## Scope of the strict tolerance

Tight tolerance applies to **navigationally significant currents** (≥ 0.75 kn). Mixed-tide
stations have weak sub-¾-knot *relaxation* extrema where the velocity curve is nearly flat
(timing ill-conditioned) or straddles zero (flood/ebb sign ambiguous — NOAA −0.13 vs engine
+0.02 kn). These disagree by tens of minutes but are ill-conditioned in NOAA's computation
too and operationally irrelevant; they're reported, not gated. The strong currents that
matter — Rosario's −4 kn ebb, +3 kn flood — match to 1–2 minutes.

## Two bugs a diverse batch caught (n=1 wouldn't have)

- **Per-bin references.** A subordinate references a specific *bin* of its reference; some
  references publish multiple bins with different constituents (`SFB1201`: [26,20,10]).
  Storing one silently used the wrong constituents (~50 min off). Fixed: key harmonic
  entries by (id, bin).
- **Type-S with own harmonics.** Some NOAA `type: S` stations carry their own harcon and are
  predicted harmonically, not by the reduction (`PUG1716`: 89 min off as a reduction, 6.8 min
  as harmonic). Fixed: prefer own harcon; reduce only stations with an empty harcon.

## Not covered (deferred)

- **CHS / Canadian currents** — NOAA is US-only; the Canadian side of the Salish Sea (Active
  Pass, BC side of Boundary) needs CHS data + own harmonic analysis.
- **Rotary currents** — the minor axis is bundled but unused; type-W (weak/variable) stations
  are skipped.
- **Subordinate continuous curve** — subordinate stations expose the event list, not a
  continuous velocity series.

See [`docs/research/2026-07-18-noaa-currents-api.md`](../research/2026-07-18-noaa-currents-api.md)
for the full NOAA API findings.

> **Not for navigation.** Predictions are astronomical estimates and do not account for wind,
> freshet, or local effects. Carry official current tables and charts.
