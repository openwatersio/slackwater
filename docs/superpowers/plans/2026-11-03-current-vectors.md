# Current vector implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Return current magnitude and true direction in timelines across TypeScript, Swift, and Kotlin while preserving signed speed and events.

**Architecture:** Evaluate the minor axis with the existing harmonic machinery on the major timeline. NOAA's positive minor axis is 90 degrees clockwise from the major axis, so bearing is `azimuth + atan2(v, u)` normalized to [0, 360). Subordinates and stations without minor data use absolute speed and published phase directions.

**Tech stack:** Existing TypeScript/Vitest, Swift/Testing, and Kotlin/JUnit engines.

**Spec:** Scope approved in chat for issue #434: all three engines, shared fixtures, API fields, tests and documentation; database extraction is a follow-up.

## Global constraints

- Keep signed major-axis speed, event values, event times, and event labels unchanged.
- Return magnitude for every predicted point; omit direction at zero magnitude or when the bearing is unknown.
- Keep existing Swift and Kotlin point initializers usable through defaults and preserve Java constructors with JVM overloads. Swift direction inputs are optional, while existing numeric phase properties retain their types.
- Accept optional minor constituents and minor mean flow; default vector azimuth to flood direction when available.
- Use existing nodal corrections on both axes; no new dependencies.
- Do not add station data or change database bundle policy.

## Review focus

- Unknown phase bearings must stay unknown, including a missing azimuth with minor flow.
- Nonreciprocal published ebb bearings apply to one-axis fallbacks, not vector rotation.
- Minor mean flow alone must contribute even with no minor harmonics.
- Zero vectors have no physical bearing; nonzero cross-flow at major-axis slack has one.
- Both axes must use the same times and nodal correction windows over multiple days.

## Review decisions

- Effective minor data requires a nonzero recognized amplitude or mean cross-flow; empty and ineffective axes use the published phase bearings.
- Swift retains missing bearings internally while preserving the numeric phase properties and Java retains the two-field point copy overload.
- OpenAPI magnitude remains optional for cached responses from older servers, while predictors always emit it.
- NOAA speed_dir output provides an independent physical check of bearing orientation alongside the shared synthetic parity fixture.

## Tasks

### 1. TypeScript timeline contract

- [x] Add failing analytic tests for cardinal rotation, wrapping, quadrants, mean cross-flow, unknown and zero bearings, one-axis and subordinate fallbacks, and event invariance.
- [x] Run the current tests and confirm failures concern missing vector fields.
- [x] Extend `CurrentPredictionOptions` with `minorConstituents`, `minorMeanFlow`, and `azimuth`; extend `CurrentPoint` with magnitude and optional direction. Add the optional fields to `CurrentStationData` and pass them through `useCurrentStation`.
- [x] Run engine and station tests. Keep point construction source-compatible where possible.

### 2. Cross-language contract

- [x] Extend the currents fixture generator with a separate rotary fixture section, retaining the existing speed/event parity rows.
- [x] Add failing Swift and Kotlin tests for vector fields, analytic bearings, fallbacks, initializer compatibility, and unchanged events.
- [x] Extend `CurrentStation` options and `CurrentPoint` in each port; update subordinate timelines with their own phase bearings.
- [x] Run Swift release tests and Kotlin tests, coverage verification and source consumer with JDK 17.

### 3. Consumer contract and verification

- [x] Add API schema properties and assertions that timeline magnitude and direction survive API/CLI output.
- [x] Document options and fallback semantics in engine, Swift, Kotlin and API READMEs and CONTRIBUTING; add a feature changeset.
- [x] Run TypeScript coverage, build, lint, fixtures check, Swift release tests, and Kotlin coverage and smoke checks.
- [x] Run Open Waters local branch review, verify findings, fix real problems with regression tests, and commit the reviewed change.

## Verification and review

TypeScript: 2,616 tests pass; the modified engine calculation and station-wrapper files have 100% statement and branch coverage. Build, lint, and fixture verification pass. Swift release tests pass. Kotlin and Java tests, 100% handwritten line coverage, and the source-consumer smoke check pass.

Three Open Waters review rounds completed: Codex, Claude Opus and Sonnet in round one; Opus and Sonnet in rounds two and three. Copilot was unavailable. Claude reviews were static; Codex also ran read-only compilation, fixture, handler, base-versus-branch numerical, and resource probes. Sonnet's final-round findings were recovered from its structured ReportFindings output because the text report contained only the reader/writer map.

The fixes cover empty and ineffective minor axes, nullable station metadata, missing Swift bearings, Swift source compatibility, Java constructors and point copying, old-response schema compatibility, and vector contract documentation. An independent NOAA fixture checks clockwise rotation and significant-current direction accuracy; shared synthetic fixtures check port parity. The claimed OpenAPI boolean-range error was dismissed against the declared OpenAPI 3.0.3 schema. All 5,158 bundled published bearings were checked and fall in [0, 360); event/header normalization is outside this additive timeline change.

Remaining caller responsibilities: pass nil for unknown Swift bearings rather than a numeric placeholder; when editing a Kotlin point, update vector fields together because data-class copies preserve unspecified fields; rebuild precompiled Kotlin consumers when upgrading. Invalid non-finite caller constants are outside the finite-constant prediction contract. API and CLI bundled data intentionally use phase-bearing fallbacks, as the approved scope defers database extraction. A missing major-axis azimuth cannot safely be inferred from a nonreciprocal published ebb bearing. React keeps optional fields for older servers and does not introduce a vector view. NOAA's independent physical check covers one station and bin; port parity covers synthetic minor-axis inputs over three days.

The final model review is followed only by plan status, caller migration guidance, initializer documentation, and the API response-size comment. These prose/comment updates receive formatting and diff checks; no further model review is required for them.
