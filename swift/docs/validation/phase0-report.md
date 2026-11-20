# Phase 0 Validation Report — Neaps

**Date:** 2026-07-12 · **Result: GATE PASSED** ✅

> Figures here are from the report's date. Current maxima against NOAA are in [docs/CONTRACT.md](../../../docs/CONTRACT.md#physical-accuracy).

Phase 0 asked one question: can a pure-Swift harmonic engine be *accurate* — matching
both the Neaps reference and the tide authority's own published predictions, fully
offline? Yes.

## Engine correctness — vs Neaps reference

Every layer is golden-tested against `@neaps/tide-predictor@0.10.0` (the oracle). Run
with `swift test`.

| Layer | Check | Tolerance | Result |
|-------|-------|-----------|--------|
| Astronomy | mean longitudes + node angles, 8 times across the 18.6-yr nodal cycle | 1e-6° | ✅ |
| Node corrections | IHO f/u, 17 base constituents × 3 times | 1e-6 | ✅ |
| Constituents | V₀ + compound f/u, ~39 constituents × 2 times | 1e-6 | ✅ |
| Prediction | 48 h height series, mixed-tide set | < 1e-6 m | ✅ |
| Extremes | hi/lo count, kind, time, height | 60 s / 0.02 m | ✅ |

The Swift port reproduces Neaps to floating-point agreement — the *algorithm* is faithful.

## Real-world accuracy — vs the tide authority

**Friday Harbor, WA (NOAA 9449880).** Constituents from `@neaps/tide-database` (NOAA
source); target is NOAA's own CO-OPS prediction API (datum MLLW, GMT). 12 hi/lo over
2026-07-15…17:

- **Max time error: 7.9 min** · **Max height error: 3.5 cm** (tolerance ±15 min / ±0.15 m)

The engine reproduces NOAA's published tide tables to a few minutes and a few
centimetres. This is the accuracy claim the whole product rests on — confirmed.

The residual (≈8 min / 3.5 cm) is expected: NOAA's internal engine uses a different
node-correction epoch and constituent set. It is well inside navigational tide-table
tolerance.

## Data & currents availability (spec §3, §6.4)

| Source | Delivery | Status |
|--------|----------|--------|
| **NOAA** (~3400 stations) | bundled offline via `@neaps/tide-database` | ✅ highest confidence |
| **CHS / Victoria 07120** | not bundled (CHS isn't a Neaps source) — **IWLS API** serves `wlp` / `wlp-hilo` predictions online | ✅ confirmed live; fits fetch-and-cache confidence-factor design → **no constituent bundling, no licensing issue** |
| **Currents (Salish Sea)** | CHS IWLS `wcp` (Canada, **35+ stations**) + NOAA CO-OPS (US side) expose current *predictions* online | ✅ launch path is **online everywhere** (slack/max direct from the APIs). **Offline US current harmonics (XTide ingestion) is deferred to post-MVP** — a distinct pipeline, not a Phase 0 gap; see spec §4/§7 |

Key consequence: the CHS licensing question from the brief is **moot by design**. CHS
publishes *predictions* (not just constituents) through IWLS, so tides and currents in
Canadian waters come from CHS's own numbers, fetched and cached per user, marked at a
lower confidence factor when extrapolated offline. Nothing is redistributed.

**Naming:** real station data uses varied constituent naming (NOAA `NU2`, `MM`, `RHO`;
CHS variants). The catalog resolves **83 aliases** to canonical names so published
constants predict correctly.

## Recommendation

Proceed to Phase 1 (iOS app). The engine is proven; the offline core is real. The
online layer (CHS/currents fetch + cache + confidence factor) is a Phase-1 build on the
IWLS endpoints confirmed here — not a research risk. Offline US current harmonics (XTide
ingestion) is a named **post-MVP** enhancement, not a Phase 0 gap — see spec §4/§7.

**For filming:** the Airplane-Mode / Victoria money shot needs the CHS online-fetch path
(Phase 1) *or* can use a bundled NOAA station (e.g. Friday Harbor) to demo offline
accuracy today — that one already validates to 3.5 cm.
