# ETSS preservation and offline contract checks

These Python 3.11+ standard-library research tools preserve finite deterministic NOAA ETSS export attempts and original gauge observations. An external scheduler can invoke a collection tick. The tools do not score forecasts, tune timing, or accept a production adapter. A `consistent` result describes native export consistency. The optional CSV mapping validates the [NOAA-confirmed clock](provider-contract.md) and emits forecast samples for offline evaluation. `scoringPermitted` and `adapterAccepted` remain false: observation normalization, pinned comparators and truth policy, and accuracy/uncertainty acceptance are separate requirements under [slackwater#402](https://github.com/openwatersio/slackwater/issues/402).

From the repository root:

```sh
python3 -B tools/etss/capture.py \
  --date 20261013 --cycles 12 18 \
  --output .superpowers/spikes/current-anomaly/etss-preserved
python3 -B tools/etss/reader.py \
  .superpowers/spikes/current-anomaly/etss-preserved/attempt-DATE-CYCLE-ID.json
python3 -B -m unittest discover \
  -s tools/etss -p 'test_*.py' -v
```

Use the actual final manifest path printed by capture. The reader emits JSON and exits zero for `consistent`; `disagreement`, `incomplete`, and `unsupported` exit one. Invalid top-level input also emits `unsupported` JSON. Store downloaded evidence in ignored research storage, outside these reusable tools.

## Preservation

Capture requires an explicit UTC cycle date and cycles from `00`, `06`, `12`, `18`. Requests use only NOAA's fixed NOMADS origin and the deterministic `etss.DATE/etss.tHOURz.{shef,csv}.tar.gz` paths; redirects are retained as HTTP errors rather than followed. Each archive body retains every region, even though the initial reader selects only three West gauges.

Every invocation creates a UUID attempt. `bodies/SHA256.bin` stores exact bytes with exclusive atomic creation; identical bytes reuse a body, revised bytes get a new hash, and an existing mismatched body raises an error without overwriting it. `records/ID-PRODUCT-start.json` records each request before opening it; `records/ID-PRODUCT.json` records its completed or failed outcome before the next request. A pair start intent and final `attempt-DATE-CYCLE-ID.json` refer to those records. If interrupted during the second request, the first product's completed receipt remains available. An abrupt process termination can leave a request start without an outcome; it must remain unresolved, not count as missing or successful publication.

Records distinguish cycle time, request start, response-header receipt, full-body receipt and attempt finish. Full-body `receivedAt` is null for partial downloads; network failures with no response also have no response receipt or body hash. HTTP errors retain their returned status, headers and bounded body. The pair manifest expressly makes no claim of atomic publication. A local receipt is never evidence of first publication. The SHEF bulletin creation and valid times are parsed separately by the reader.

The default body limit is 16 MiB per product; an overflow retains the bounded prefix as `partial`. `--timeout` defaults to 60 seconds (maximum 300). It applies to socket operations; incremental `read1` calls preserve available bytes and check elapsed time before and after reads, including EOF. A blocked socket operation can overshoot that elapsed threshold, and DNS or response-header processing does not have a guaranteed wall-clock deadline. There are no retries or background jobs. Bodies and JSON are flushed and fsynced before exclusive atomic linking; containing directories are not fsynced, so the tools do not promise recovery from OS crashes, power loss, or storage hardware failure.

## Hourly collection tick

The collector requires macOS or Linux for its `fcntl` lock. Run one finite tick from the repository root:

```sh
python3 -B tools/etss/collect.py \
  --output .superpowers/spikes/current-anomaly/etss-continuous
```

Each invocation uses its actual UTC start time. It requests the original six-minute `water_level` JSON for Friday Harbor (`9449880`), Port Townsend (`9444900`), and Seattle (`9447130`) first, then both deterministic ETSS products for the current six-hour cycle and the prior two cycles. There are nine requests, without retries. The observation window ends at the most recent six-minute boundary and starts 120 hours earlier; every tick repeats that window to preserve revisions and prime the intended 96-hour history. Historical sample timestamps do not imply historical acquisition receipts.

Observations use NOAA's [CO-OPS data API](https://api.tidesandcurrents.noaa.gov/api/prod/) with explicit begin/end dates, `datum=MLLW`, `units=metric`, `time_zone=gmt`, `format=json`, and `application=slackwater`. Original values, standard deviations, `q`, and `f` remain untouched in the hashed body. The [response documentation](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html) gives flags different meanings for preliminary and verified data; this collector makes no quality selection. HTTP 200 API errors, malformed station metadata, malformed row schemas, off-grid timestamps, and timestamps outside the requested window produce `invalid_observations`. Six-minute gaps between otherwise valid rows are counted without filling. Diagnostics include the returned station metadata, row count, and latest sample time.

The output separates `observations/` and `forecasts/`, each with immutable attempt manifests, immediate per-request records, and content-addressed original bodies. Observation start manifests also preserve the exact query. `ticks/ID-start.json` records actual invocation time, limits, planned window/cycles, and stores before requests; `ticks/ID.json` records completion time, resulting manifests, and states. A handled interruption writes an `interrupted` completion with any completed observation references. Abrupt termination can leave a start without completion; request and cycle starts in the named stores remain unresolved evidence. Bodies and manifests are never deleted or overwritten, so hourly storage grows with new revisions.

Each complete forecast pair runs the existing offline reader and preserves its report beside its attempt manifest as `attempt-DATE-CYCLE-ID-contract.json`. `disagreement` remains a native-contract diagnostic and does not fail acquisition. `unsupported` or `incomplete` contract results fail the tick explicitly. A 404 for the current cycle is `expected_unpublished` when the other product is either complete or also 404; older-cycle 404s and other HTTP/transport failures are collection failures. Original HTTP error bodies remain available. These distinctions make no assertion about a global provider outage.

The command prints one JSON summary. Exit zero means `complete`, `complete_with_unpublished`, or `skipped_overlap`; exit one means `collection_failed`. A nonblocking `fcntl` lock on `.collection.lock` skips overlapping invocations without requests and releases on exit. A gap exceeding 90 minutes since the previous tick start appears as `acquisitionGap` with `host_or_scheduler_acquisition_uncertainty`; incomplete prior ticks still count as attempts. Collection depends on the scheduler and this host being available. Missed original receipts cannot be reconstructed later. Scheduling and notification preferences belong to the external heartbeat, while byte/time limits have the same guarantees and limitations as manual capture. Scheduled deployments should use stable code and evidence paths outside disposable worktrees so removing a checkout cannot disable collection or delete receipts.

## Observed reader contract

The reader verifies body hash, byte count, fixed product URL, UTC receipt fields and their ordering before opening successful archives. It rejects absolute or traversing paths, backslashes, duplicate members, links, sparse files, corrupt gzip/tar, more than 4,096 members, members over 1 MiB, and decompressed archives over 128 MiB. It reads selected members directly without extracting files.

Identity requires the exact observed deterministic title `:SHEF ENCODED 1 HOUR STORM SURGE + TIDE GUIDANCE`, the MLLW feet declaration and DOC/NOAA/NWS/OSTI/MDL provider declaration. A WMO heading alone cannot establish identity. Probabilistic P-ETSS titles, additional declarations, other datums or units, and unsupported parameters fail explicitly. Research stations require `HMIFV`, `Z`, and `DIH01`. Observed non-target `HMIFX` sections are excluded and reported by station, without reinterpretation.

The selected gauges are Friday Harbor (`FRDW1`, `9449880`), Port Townsend (`PTWW1`, `9444900`), and Seattle (`EBSW1`, `9447130`). Their 102 hourly SHEF values start exactly at the declared date/`DH` time; continuations must be ordered. The CSV must declare `TIME,TIDE,OB,SURGE,BIAS,TWL` and preserve increasing UTC six-minute timestamps. Missing rows are counted, never filled. The observed full CSV span is cycle minus 120 hours through cycle plus 102 hours inclusive; truncated spans are incomplete even when all SHEF comparison timestamps exist. CSV contains no units declaration, so the report labels its contract as dependent on paired SHEF and the observed October 2026 export evidence.

Three-decimal values use `Decimal`. CSV `9999.000` and SHEF `M`, `-9999`, or `-9999.000` remain missing. Unsupported precision or heights outside the observed bounded contract fail. Native same-time comparison uses a 0.001-foot tolerance for the two independently rounded values. Component checks use `TWL = TIDE + SURGE + BIAS` once, with a 0.002-foot rounding bound for four printed values. Missing components are reported and skipped, not zeroed. Neither check searches offsets, shifts timestamps, fills gaps, or measures forecast accuracy. Absent target stations and unsupported products remain visible in each station/run status.

## NOAA-confirmed CSV mapping

```sh
python3 -B tools/etss/reader.py --csv-mapping \
  /path/to/forecasts/attempt-DATE-CYCLE-ID.json
```

`--csv-mapping` keeps the native `status`, `sameTime` disagreements and original SHEF declarations. It adds `mappingContract`, aggregate `mappingStatus` and a `mapping` for each parsed station. Exit zero means all three mappings are `accepted`; `unexplained`, `incomplete`, and `unsupported` exit one. Without the flag, the reader and collector retain the native diagnostic behavior. The installed collector is pinned separately; changing the checkout does not redeploy it or rewrite saved reports.

The mapping uses the complete 79 hourly CSV BIAS values from cycle +24 through +102 hours, matching the bounded signature audited in #401. The earlier bias can vary while blending observations even in a constant-tail run. Missing tail support yields `unknown`, never constant by default. Equal printed tail values select the same-time relationship; varying printed values select comparison to CSV one hour later. This is a conservative observed export contract, not a provider-supplied FFT flag. A future changed layout, an unrecognized branch or an unexplained mismatch requires review.

All 102 SHEF values must match the selected CSV relationship within 0.001 feet. Timing flags or component arithmetic exceptions are `unexplained`. The full observed CSV span and all four forecast components at each of the 103 hourly times from cycle through +102 hours must exist; incomplete support emits no forecast. Historical observation sentinels remain allowed. Missing input is never interpolated, replaced with zero, or repaired by testing other time offsets. The Shishmaref exceptions are outside these three gauges and remain unresolved.

An accepted station mapping exposes `forecast` samples with `validAt` copied from CSV TIME, `csvFeet`, and `heightMeters` using exactly 0.3048 meters per foot. Both heights are decimal strings. TWL already includes TIDE, SURGE and BIAS; no component or observation anchor is added. SHEF times and values are never relabeled. Forecast output includes cycle and +102h endpoints independently of the SHEF's 102-value support.

Mapping acceptance establishes the export relationship only. Consumers must enforce decision-time receipt eligibility and the frozen paired-capture rules, retain body hashes and contract ID, select exact targets, and apply fallback when unavailable. A report can have native `status: disagreement` and `mappingStatus: accepted` for the documented FFT bug. Per-station forecasts in a partially failed report do not authorize use of the entire pair. No scoring or production acceptance follows from a successful mapping.

## Fixtures

`fixtures/provenance.json` attributes exact text excerpts to original NOAA URLs, source archive/member hashes, capture receipts, and extraction boundaries. The Seattle October 12, 2026 00Z and 12Z fixtures each retain the complete 102-value SHEF section and only 31 contiguous CSV rows (00:00 through 03:00 and 12:00 through 15:00 UTC), with original printed precision and sentinels. The 00Z control agrees at its four available same-time comparisons, while 12Z retains the disagreement. Both CSV excerpts are intentionally incomplete; neither is a full capture or scoring sample. The control is original observed evidence, without a timestamp adjustment.

`fixtures/mapping-provenance.json` records the original archive/member hashes and receipt times for complete Seattle CSV members and SHEF sections from October 13 18Z (constant tail) and October 14 00Z (varying tail). CSV members are stored as lossless gzip fixtures with a deterministic compression timestamp; decompressed bytes retain their original TIME and printed values. These cover a bias-mode change at the same station and are development evidence only.

The public APIs are `capture.capture_cycle(date, cycle, output)` returning a final manifest path, and `reader.validate_manifest(path, csv_mapping=False)` returning the JSON-compatible report. Set `csv_mapping=True` for the optional mapped output. Parsing and comparison helpers support offline tests and inspection; only manifest validation checks archive hashes and receipt metadata.

# Prepare comparison inputs

`prepare.py` selects original receipts at a daily 02:00 UTC decision, normalizes exact-hour observations and prepares unchanged tide, full CSV TWL, mean24, persistence and the fixed surge-change comparator. It reads existing evidence and writes JSON to stdout. It performs no fetching or accuracy scoring. The [evaluation policy](evaluation-policy.md) fixes research quality, revision, support and truth-vintage rules.

```sh
python3 -B tools/etss/prepare.py \
  --data /path/to/etss-collection/data \
  --tides /path/to/frozen-tides.json \
  --tides-sha256 <recorded-sha256> \
  --decision 2026-10-14T02:00:00Z \
  --truth-as-of 2026-10-15T12:00:00Z > /path/to/new-report.json
```

Use a new report path for each snapshot. The output includes original selected row fields, body and manifest hashes, receipt cutoffs, forecast selection, per-method fallback reasons and independent truth availability at each horizon. Primary truth accepts preliminary or verified rows within a fixed 24-hour revision window; it is unavailable until that window has elapsed. `observations.select_hourly(..., verified_only=True)` supports separately labeled verified-data checks. A later truth snapshot cannot alter decision inputs or advance the primary truth cutoff.
