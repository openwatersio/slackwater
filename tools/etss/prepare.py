"""Prepare auditable daily ETSS comparison inputs without scoring outcomes."""

import argparse
import hashlib
import json
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import comparators
import observations
import reader
from observations import utc
from reader import iso, require


POLICY = "etss-comparison-inputs-2026-10-15-v1"


def choose_forecast(paths, station, decision_at):
    decision = utc(decision_at)
    cycle = decision - timedelta(hours=8)
    attempts, candidates = [], []
    for path in sorted(paths):
        try:
            with path.open("rb") as stream:
                data = stream.read(1024 * 1024 + 1)
            require(len(data) <= 1024 * 1024, "manifest exceeds byte limit")
            doc = json.loads(data)
            if doc["cycleAt"] != iso(cycle):
                continue
            products = doc["products"]
            require(all(products[k]["state"] == "complete" and products[k]["status"] == 200
                        for k in ("csv", "shef")), "incomplete_pair")
            for k in ("csv", "shef"):
                reader.verify_receipt(products[k])
            received = max(utc(products[k]["receivedAt"]) for k in ("csv", "shef"))
            require(cycle <= received <= decision, "pair_not_received_by_decision")
            for k in ("csv", "shef"):
                reader.verified_body(path.parent, products[k])
            candidates.append((received, path.name, path, hashlib.sha256(data).hexdigest()))
        except (OSError, ValueError, TypeError, KeyError) as error:
            attempts.append({"manifest": path.name, "reason": str(error)})
    result = {"cycleAt": iso(cycle), "manifest": None, "forecast": {}, "surge": None,
              "reason": "no_eligible_pair", "excludedAttempts": attempts}
    if not candidates:
        return result
    received, name, path, digest = min(candidates)
    result.update(manifest=name, manifestSha256=digest, receivedAt=iso(received))
    try:
        report = reader.validate_manifest(path, csv_mapping=True)
        result["products"] = report["products"]
        nws = next(n for n, s in reader.STATIONS.items() if s == station)
        mapping = report["stations"][nws].get("mapping", {})
        require(mapping.get("status") == "accepted",
                "mapping_" + mapping.get("status", "unsupported"))
        doc = json.loads(path.read_text())
        member = f"etss.{doc['date']}/t{doc['cycle']}z.csv/{station}.csv"
        body = reader.verified_body(path.parent, doc["products"]["csv"])
        rows = reader.parse_csv(reader.read_archive(body, {member})[member])["rows"]
        surge = [rows[cycle + timedelta(hours=h)]["SURGE"] for h in range(97)]
        require(all(v is not None for v in surge), "missing_surge_support")
        result.update(forecast={r["validAt"]: float(r["heightMeters"]) for r in mapping["forecast"]},
                      surge=[float(v * Decimal("0.3048")) for v in surge],
                      mappingContract=report["mappingContract"], reason=None)
    except (OSError, ValueError, TypeError, KeyError, StopIteration) as error:
        result["reason"] = str(error)
    return result


def prepare(data_root, tide_path, tide_hash, decision_at, truth_as_of):
    data_root, tide_path = Path(data_root), Path(tide_path)
    decision, truth_cutoff = utc(decision_at), utc(truth_as_of)
    require((decision.hour, decision.minute, decision.second, decision.microsecond) == (2, 0, 0, 0),
            "protocol requires daily 02:00 UTC decisions")
    require(truth_cutoff >= decision, "truth snapshot predates decision")
    data = tide_path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == tide_hash, "frozen tide bundle hash mismatch")
    tides = json.loads(data)
    require(tides["schemaVersion"] == 1 and tides["datum"] == "MLLW" and tides["units"] == "meters" and
            tides["nodeCorrections"] == "iho" and isinstance(tides["provenance"], dict) and tides["provenance"],
            "unsupported tide bundle")
    sources = ("prepare.py", "observations.py", "comparators.py", "reader.py", "collect.py")
    result = {"policy": POLICY, "decisionAt": iso(decision), "truthAsOf": iso(truth_cutoff),
              "tideSha256": tide_hash, "tideProvenance": tides["provenance"], "stations": {},
              "codeHashes": {s: hashlib.sha256(Path(__file__).with_name(s).read_bytes()).hexdigest() for s in sources},
              "scoresComputed": False, "productionAccepted": False}
    obs_paths = sorted(p for p in (data_root / "observations").glob("attempt-*.json") if not p.name.endswith("-start.json"))
    grouped = {p: json_station(p) for p in obs_paths}
    result["unassignedObservationManifests"] = [p.name for p, station in grouped.items() if station not in reader.STATIONS.values()]
    forecast_paths = sorted(p for p in (data_root / "forecasts").glob("attempt-*.json")
                            if not p.name.endswith(("-start.json", "-contract.json")))
    for station in reader.STATIONS.values():
        # Partitioning is only an optimization; each body must independently match its station.
        paths = [p for p, identity in grouped.items() if identity == station]
        receipt_cache = {}
        history = observations.select_hourly(paths, station, iso(decision - timedelta(hours=96)),
                                              iso(decision - timedelta(hours=1)), iso(decision), receipt_cache=receipt_cache)
        tide = tides["stations"][station]
        required = [s["validAt"] for s in history["hours"]] + [iso(decision + timedelta(hours=h)) for h in comparators.HORIZONS]
        require(all(comparators.finite(tide.get(at)) for at in required), "missing or invalid frozen tide hour")
        residuals = [float(s["heightMeters"]) - tide[s["validAt"]] if s["heightMeters"] is not None else None
                     for s in history["hours"]]
        model = choose_forecast(forecast_paths, station, iso(decision))
        targets = []
        for h in comparators.HORIZONS:
            at = iso(decision + timedelta(hours=h))
            mature_at = decision + timedelta(hours=h + 24)
            truth = observations.select_hourly(paths, station, at, at, iso(min(truth_cutoff, mature_at)), receipt_cache=receipt_cache)
            sample = truth["hours"][0]
            reason = "truth_not_mature" if truth_cutoff < mature_at else (
                "no_valid_truth_receipt" if sample["heightMeters"] is None else None)
            targets.append({"horizonHours": h, "validAt": at, "truth": sample if sample["heightMeters"] is not None else None,
                            "truthReason": reason, "truthMaturesAt": iso(mature_at), "truthReceipts": truth["receipts"],
                            "methods": comparators.forecasts(tide[at], residuals, h, model["forecast"].get(at), model["surge"])})
            if reason:
                targets[-1]["truth"] = None
        result["stations"][station] = {"history": history,
                                        "model": model, "targets": targets}
    return result


def json_station(path):
    try:
        with path.open("rb") as stream:
            data = stream.read(1024 * 1024 + 1)
        require(len(data) <= 1024 * 1024, "manifest exceeds byte limit")
        station = json.loads(data)["station"]
        return station if isinstance(station, str) else None
    except (OSError, ValueError, TypeError, KeyError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--tides", type=Path, required=True)
    parser.add_argument("--tides-sha256", required=True)
    parser.add_argument("--decision", required=True)
    parser.add_argument("--truth-as-of", required=True)
    args = parser.parse_args()
    try:
        report = prepare(args.data, args.tides, args.tides_sha256, args.decision, args.truth_as_of)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"state": "invalid_inputs", "error": str(error)}))
        return 1
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
