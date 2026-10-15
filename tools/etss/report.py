"""Offline accuracy report for the fixed ETSS prospective evaluation (#402)."""

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import labels
import prepare
import reader
import scoring
from comparators import HORIZONS, finite
from observations import utc
from reader import iso, require
from scoring import METHODS


STATIONS = tuple(reader.STATIONS.values())
POLICY = "etss-accuracy-report-2026-10-15-v1"
COHORTS = {"calibration": ("2026-11-01", "2026-11-30"),
           "confirmation": ("2026-12-04", "2027-01-31")}
PIN = Path(__file__).with_name("evaluation-pin.json")


def now():
    return datetime.now(timezone.utc)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def document_hash(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True, allow_nan=False).encode()).hexdigest()


def calendar(phase, first, last):
    require(phase in (*COHORTS, "development"), "unknown phase")
    if phase in COHORTS:
        require(first is None and last is None, "formal calendars cannot be narrowed")
        first, last = COHORTS[phase]
    require(isinstance(first, str) and isinstance(last, str), "development requires first and last date")
    begin, end = (utc(s + "T02:00:00Z") for s in (first, last))
    require(begin <= end and end - begin <= timedelta(days=90), "invalid decision range")
    require(phase != "development" or end < utc("2026-11-01T00:00:00Z"),
            "development must precede the frozen calibration cohort")
    return [begin + timedelta(days=d) for d in range((end - begin).days + 1)]


def verify_pin(tide_path, pin_path=PIN):
    pin = json.loads(Path(pin_path).read_text())
    require(digest(tide_path) == pin["tideBundleSha256"], "tide bundle differs from evaluation pin")
    root = Path(__file__).resolve().parents[2]
    require(all(digest(root / name) == value for name, value in pin["files"].items()),
            "pinned input code changed; review a new stratum before scoring")
    return {"policy": POLICY, "inputPinSha256": digest(pin_path), "tideSha256": pin["tideBundleSha256"],
            "inputHashes": pin["files"], "reportHashes": {name: digest(Path(__file__).with_name(name))
                for name in ("report.py", "labels.py", "scoring.py")},
            "forecastStratum": "noaa-confirmed-csv-time-2026-10-14-v1; CSV millifoot SURGE"}


def validate_widths(widths, contract):
    require(widths["policy"] == POLICY and widths["contract"] == contract, "width contract mismatch")
    frozen = utc(widths["frozenAt"])
    require(utc("2026-12-03T13:00:00Z") <= utc(widths["truthAsOf"]) <= frozen < utc("2026-12-04T02:00:00Z"),
            "widths must be frozen after calibration truth matures and before confirmation")
    require(set(widths["radii"]) == set(METHODS) and all(
        set(widths["radii"][m]) == set(map(str, HORIZONS)) and
        all(finite(v) and v >= 0 for v in widths["radii"][m].values()) for m in METHODS),
        "widths require finite nonnegative radii from all gauges at every horizon")


def calibration_radii(source):
    require(source["phase"] == "calibration" and source["policy"] == POLICY, "only calibration can freeze widths")
    days = calendar("calibration", None, None)
    require(source["firstDecision"] == iso(days[0]) and source["lastDecision"] == iso(days[-1]), "wrong calibration cohort")
    require(set(source["cases"]) == set(STATIONS), "calibration requires all three gauges")
    for horizons in source["cases"].values():
        require(set(horizons) == set(map(str, HORIZONS)), "calibration requires every horizon")
        for rows in horizons.values():
            require([r["date"] for r in rows] == [d.date().isoformat() for d in days], "incomplete calibration calendar")
            for row in rows:
                require(row["truth"] is None or finite(row["truth"]), "invalid calibration truth")
                require(set(row["methods"]) == set(METHODS) and
                        all(finite(m["heightMeters"]) for m in row["methods"].values()), "invalid calibration predictions")
    result = {m: {str(h): scoring.shared_radius({s: source["cases"][s][str(h)] for s in STATIONS}, m)
                  for h in HORIZONS} for m in METHODS}
    require(result == source["calibratedRadii"], "calibration radii disagree with original case errors")
    return result


def freeze_widths(source):
    radii = calibration_radii(source)
    result = {"policy": POLICY, "frozenAt": iso(now()), "truthAsOf": source["truthAsOf"],
              "contract": source["contract"], "radii": radii,
              "calibrationReportSha256": document_hash(source)}
    require(utc(source["truthAsOf"]) <= utc(source["generatedAt"]) <= utc(result["frozenAt"]), "calibration report follows freeze")
    validate_widths(result, source["contract"])
    return result


def read_widths(path, expected_hash, contract, calibration_path):
    require(digest(path) == expected_hash, "frozen widths hash mismatch")
    result = json.loads(Path(path).read_text())
    validate_widths(result, contract)
    require(calibration_path is not None, "original calibration report is required")
    source = json.loads(Path(calibration_path).read_text())
    require(document_hash(source) == result["calibrationReportSha256"], "calibration report hash mismatch")
    require(source["contract"] == contract and source["truthAsOf"] == result["truthAsOf"] and
            utc(source["truthAsOf"]) <= utc(source["generatedAt"]) <= utc(result["frozenAt"]), "calibration provenance mismatch")
    require(calibration_radii(source) == result["radii"], "frozen widths disagree with calibration case errors")
    return result


def evidence_index(root):
    index = {"observations": [], "forecasts": [], "rejectedManifests": []}
    for kind in ("observations", "forecasts"):
        for path in sorted((Path(root) / kind).glob("attempt-*.json")):
            if path.name.endswith(("-start.json", "-contract.json")):
                continue
            try:
                with path.open("rb") as stream:
                    data = stream.read(1024 * 1024 + 1)
                require(len(data) <= 1024 * 1024, "manifest exceeds byte limit")
                doc = json.loads(data)
                item = {"path": str(path), "sha256": hashlib.sha256(data).hexdigest()}
                if kind == "observations":
                    require(doc["station"] in STATIONS, "unsupported station")
                    begin, end = (reader.instant(doc["query"][k], "%Y%m%d %H:%M") for k in ("begin_date", "end_date"))
                    item.update(station=doc["station"], beginAt=iso(begin), endAt=iso(end), receivedAt=iso(utc(doc["record"]["receivedAt"])))
                else:
                    item["cycleAt"] = iso(utc(doc["cycleAt"]))
                index[kind].append(item)
            except (OSError, ValueError, TypeError, KeyError) as error:
                index["rejectedManifests"].append({"path": str(path), "reason": str(error)})
    return index


def observation_paths(index, begin, end, cutoff):
    # Validated rows cannot lie outside the query; later receipts cannot meet a decision or truth deadline.
    return [Path(r["path"]) for r in index["observations"] if utc(r["endAt"]) >= begin and
            utc(r["beginAt"]) <= end and utc(r["receivedAt"]) <= cutoff]


def decision_paths(index, decision):
    return (observation_paths(index, decision - timedelta(hours=96), decision + timedelta(hours=24),
                              decision + timedelta(hours=48)),
            [Path(r["path"]) for r in index["forecasts"] if utc(r["cycleAt"]) == decision - timedelta(hours=8)])


def acquisition(data_root, snapshot):
    records, rejected = [], []
    starts, completed = {}, set()
    for path in sorted((Path(data_root) / "ticks").glob("*.json")):
        try:
            doc = json.loads(path.read_text())
            if utc(doc["startedAt"]) > snapshot:
                continue
            if path.name.endswith("-start.json"):
                starts[path.name.replace("-start.json", ".json")] = {"manifest": path.name, "sha256": digest(path), "startedAt": doc["startedAt"]}
                continue
            if utc(doc["finishedAt"]) > snapshot:
                starts.setdefault(path.name, {"manifest": path.name, "sha256": digest(path), "startedAt": doc["startedAt"]})
                continue
            completed.add(path.name)
            records.append({"manifest": path.name, "sha256": digest(path), **{k: doc.get(k) for k in
                ("startedAt", "finishedAt", "state", "acquisitionGap", "observations", "forecasts")}})
        except (OSError, ValueError, TypeError, KeyError) as error:
            rejected.append({"manifest": path.name, "reason": str(error)})
    return {"scope": "All saved ticks completed by snapshot; not proof of continuous acquisition or provider-wide failures",
            "states": dict(Counter(r["state"] for r in records)),
            "recordedGapCount": sum(r["acquisitionGap"] is not None for r in records),
            "ticks": records, "unfinishedAttempts": [v for k, v in sorted(starts.items()) if k not in completed],
            "rejectedManifests": rejected}


def verdict(phase, mature, gates):
    result = {}
    for method in METHODS:
        values = [gates[s][str(h)][method] for s in STATIONS for h in HORIZONS]
        result[method] = ("development_only" if phase == "development" else
                          "calibration_only" if phase == "calibration" else
                          "inconclusive" if not mature or "inconclusive" in values else
                          "fail" if "fail" in values else "pass")
    return result


def build(data_root, tide_path, phase, truth_as_of, first=None, last=None, *,
          pin_path=PIN, widths_path=None, widths_hash=None, calibration_path=None):
    snapshot = utc(truth_as_of)
    decisions = calendar(phase, first, last)
    require(decisions[-1] <= snapshot <= now(), "snapshot must follow scheduled decisions and cannot be in the future")
    require(phase == "development" or Path(pin_path) == PIN, "formal reports require the repository evaluation pin")
    contract = verify_pin(tide_path, pin_path)
    require((widths_path is None) == (widths_hash is None), "widths file and hash are required together")
    require(phase != "confirmation" or widths_path is not None, "confirmation requires previously frozen widths")
    require(calibration_path is None or widths_path is not None, "calibration report requires widths")
    widths = read_widths(widths_path, widths_hash, contract, calibration_path) if widths_path else None
    require(widths is None or utc(widths["frozenAt"]) <= snapshot, "width freeze follows snapshot")
    tide = json.loads(Path(tide_path).read_text())["stations"]
    root = Path(data_root)
    index = evidence_index(root)
    obs_paths = set(observation_paths(index, decisions[0] - timedelta(hours=35), decisions[-1] + timedelta(hours=59), snapshot))
    grouped = {s: [Path(r["path"]) for r in index["observations"] if r["station"] == s and Path(r["path"]) in obs_paths] for s in STATIONS}
    label_reports = {s: labels.rapid_labels(grouped[s], s, decisions, tide[s], snapshot) for s in STATIONS}
    inputs, caches = [], {s: {} for s in STATIONS}
    for decision in decisions:
        observations, forecasts = decision_paths(index, decision)
        inputs.append(prepare.prepare(root, tide_path, contract["tideSha256"], iso(decision), iso(snapshot),
                                      observation_paths=observations, forecast_paths=forecasts, receipt_caches=caches))
        active = set(observations)
        for cache in caches.values():
            for key in list(cache):
                if key[0] not in active:
                    del cache[key]
    cases = {s: {str(h): [] for h in HORIZONS} for s in STATIONS}
    for position, prepared in enumerate(inputs):
        for station in STATIONS:
            day = label_reports[station]["calendar"][position]
            for target in prepared["stations"][station]["targets"]:
                cases[station][str(target["horizonHours"])].append({
                    "date": day["date"], "decisionAt": prepared["decisionAt"], "validAt": target["validAt"],
                    "truth": float(target["truth"]["heightMeters"]) if target["truth"] else None,
                    "truthReason": target["truthReason"], "rapid": day["rapid"], "episode": day["episode"],
                    "methods": target["methods"]})
    calibrated = {m: {str(h): scoring.shared_radius({s: cases[s][str(h)] for s in STATIONS}, m)
                      for h in HORIZONS} for m in METHODS} if phase == "calibration" else None
    scores = {s: {str(h): {m: scoring.cell(cases[s][str(h)], m, widths["radii"][m][str(h)] if widths else None)
                           for m in METHODS} for h in HORIZONS} for s in STATIONS}
    gates = {s: {str(h): {m: scoring.gate(scores[s][str(h)][m], h) for m in METHODS}
                 for h in HORIZONS} for s in STATIONS}
    mature = snapshot >= decisions[-1] + timedelta(hours=83)
    return {"policy": POLICY, "phase": phase, "generatedAt": iso(now()), "truthAsOf": iso(snapshot),
            "firstDecision": iso(decisions[0]), "lastDecision": iso(decisions[-1]), "calendarMature": mature,
            "contract": contract, "widths": widths, "widthsSha256": widths_hash, "calibratedRadii": calibrated,
            "scores": scores, "cellGates": gates, "acceptance": verdict(phase, mature, gates),
            "productionAccepted": False, "cases": cases, "labels": label_reports,
            "inputs": inputs, "evidenceIndex": index, "acquisition": acquisition(root, snapshot)}


def markdown(result):
    lines = [f"{result['phase'].title()} ETSS accuracy report. Heights and errors are meters on MLLW.", "",
             f"Decisions: {result['firstDecision']} through {result['lastDecision']}. Truth snapshot: {result['truthAsOf']}.", "",
             "These research results do not establish production acceptance. Missing truth and unknown rapid labels remain excluded only from their respective denominators.", ""]
    for station, horizons in result["scores"].items():
        lines += [f"## {station}", "", "| Horizon | Method | n | MAE | RMSE | p95 | Max | Fallback | Rapid n | Unknown labels | Coverage |",
                  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for horizon, methods in horizons.items():
            for method, cell in methods.items():
                metric = cell["overall"]
                values = [horizon, method, metric["count"], *[metric[k] for k in ("mae", "rmse", "p95", "max")],
                          cell["fallbackCount"], cell["rapid"]["count"], cell["unknownLabels"], metric["coverage"]]
                lines.append("| " + " | ".join("—" if v is None else f"{v:.4f}" if isinstance(v, float) else str(v) for v in values) + " |")
        lines.append("")
    lines += ["Research verdicts: " + "; ".join(f"{m}: {v}" for m, v in result["acceptance"].items()) + ".", "",
              "The JSON includes per-case provenance, missing-truth reasons, rapid-label support, shared radii, paired differences, corrected subsets, worst episodes, leave-one-date-out ranges and acquisition records.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "tides", "truth-as-of", "phase"):
        parser.add_argument("--" + name, required=True)
    for name in ("first", "last", "widths", "widths-sha256", "calibration-report", "markdown", "freeze-widths"):
        parser.add_argument("--" + name)
    args = parser.parse_args()
    try:
        result = build(args.data, args.tides, args.phase, args.truth_as_of, args.first, args.last,
                       widths_path=args.widths, widths_hash=args.widths_sha256, calibration_path=args.calibration_report)
        frozen = freeze_widths(result) if args.freeze_widths else None
        for path, contents in ((args.markdown, markdown(result)),
                               (args.freeze_widths, json.dumps(frozen, indent=2, allow_nan=False))):
            if path:
                require(not Path(path).resolve().is_relative_to(Path(args.data).resolve()), "derived output cannot enter evidence store")
                with Path(path).open("x") as stream:
                    stream.write(contents)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"state": "invalid_inputs", "error": str(error)}))
        return 1
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
