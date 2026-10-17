# NOAA ETSS CSV clock contract

NOAA confirms that deterministic ETSS CSV is correct and SHEF is off by one hour when bias uses the time-varying FFT method. Constant-bias runs are unaffected by this clock bug. FFT activation is dynamic; SHEF alone and a fixed station list cannot identify affected runs.

Source: NOAA email reply shared by the maintainer on October 14, 2026, recorded in [slackwater#401](https://github.com/openwatersio/slackwater/issues/401#issuecomment-6170503674). The supplied reply states:

> The CSV file is correct, while the SHEF file is off by one hour.

NOAA dates the bug to the FFT implementation in August 2023. The planned August 2026 v1.5 fix was cancelled during the accelerated supercomputer transition; NOAA estimates a fix around August 2028. That estimate is not an expiry rule for this implementation. A changed export contract requires explicit review. Exact deployed build hashes and producer source were not supplied.

Contract ID: `noaa-confirmed-csv-time-2026-10-14-v1`.

The reader uses original CSV TWL at TIME. It leaves SHEF unchanged and checks its expected relationship against CSV. In the audited varying-bias samples, SHEF's declared time is one hour earlier than the matching CSV value. Same-time agreement is expected for the constant-tail cases. Neither relation is selected by comparison to observations or forecast error.

The implementation's bounded branch signature is the complete hourly BIAS tail from +24 through +102 hours. This signature comes from the retained October 2026 cross-format audit; NOAA confirms the varying-FFT versus constant distinction but does not supply a machine-readable flag or this exact classification window. Every selected relationship must also pass all 102 numeric comparisons. Insufficient support, unexpected differences and component arithmetic exceptions remain unavailable. The scope is Friday Harbor, Port Townsend and Seattle in the observed October 2026 layout. Separate Shishmaref exceptions remain unresolved.

The provider explanation covers the bug lifetime, including 2024/2025, but does not classify particular historical runs. Historical replay still needs original CSVs and compatible product/receipt evidence. NOAA offered to investigate archive access; availability is unconfirmed.

This contract establishes forecast timestamps and cross-format checks. Observation normalization, decision-time receipt selection, pinned prediction/comparator inputs and truth policy remain prerequisites for the frozen accuracy evaluation in #402. The Kotlin follow-up #395 waits for accepted behavior.
