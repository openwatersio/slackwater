"""Collect one finite tick of original NOAA observations and ETSS products."""

import argparse
import fcntl
import json
import math
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import capture
import reader


STATIONS = ("9449880", "9444900", "9447130")
OBSERVATION_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def timestamp(value):
    return value.isoformat().replace("+00:00", "Z")


def write_manifest(path, document):
    capture.immutable_write(path, (json.dumps(document, indent=2) + "\n").encode())


def observation_diagnostics(body, station, begin, end):
    document = json.loads(body)
    if not isinstance(document, dict) or "error" in document:
        raise ValueError("observation response is not data or contains an API error")
    metadata = document.get("metadata")
    if not isinstance(metadata, dict) or metadata.get("id") != station or not all(
            isinstance(metadata.get(key), str) and metadata[key] for key in ("name", "lat", "lon")):
        raise ValueError("missing or wrong observation station metadata")
    lat, lon = float(metadata["lat"]), float(metadata["lon"])
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError("invalid station coordinates")
    rows = document.get("data")
    if not isinstance(rows, list) or not rows:
        raise ValueError("observation data must be a nonempty row array")
    previous = None
    missing = 0
    for row in rows:
        if not isinstance(row, dict) or not all(isinstance(row.get(key), str) for key in ("t", "v", "s", "f", "q")):
            raise ValueError("invalid observation row schema")
        at = datetime.strptime(row["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        if at.strftime("%Y-%m-%d %H:%M") != row["t"] or at.minute % 6 or not begin <= at <= end:
            raise ValueError("observation timestamp is off grid or outside requested window")
        if previous is not None:
            if at <= previous:
                raise ValueError("observation timestamps must increase")
            missing += int((at - previous).total_seconds() // 360) - 1
        previous = at
    return {"rowCount": len(rows), "latestSampleAt": timestamp(previous), "missingRowsBetweenSamples": missing,
            "stationMetadata": metadata}


def collect_observation(output, attempt, station, begin, end, max_bytes, timeout):
    query = {"product": "water_level", "station": station,
             "begin_date": begin.strftime("%Y%m%d %H:%M"), "end_date": end.strftime("%Y%m%d %H:%M"),
             "datum": "MLLW", "units": "metric", "time_zone": "gmt", "format": "json",
             "application": "slackwater"}
    store = output / "observations"
    path = f"observations/attempt-{attempt}-{station}.json"
    record_path = store / "records" / f"{attempt}-{station}.json"
    metadata = {"schemaVersion": 1, "attemptId": attempt, "station": station, "query": query,
                "recordPath": str(record_path.relative_to(output)), "receiptIsFirstPublication": False}
    write_manifest(output / path.replace(".json", "-start.json"), metadata)
    record = capture.capture_product(OBSERVATION_URL + "?" + urlencode(query), store,
                                     max_bytes, timeout, record_path)
    metadata.update({"record": record, "state": record["state"], "error": record["error"]})
    if record["state"] == "complete":
        try:
            metadata.update(observation_diagnostics((store / "bodies" / (record["sha256"] + ".bin")).read_bytes(),
                                                    station, begin, end))
        except (ValueError, UnicodeError) as error:
            metadata.update({"state": "invalid_observations", "error": str(error)})
    write_manifest(output / path, metadata)
    return {"station": station, "manifest": path, "state": metadata["state"], "error": metadata["error"]}


def collect_forecast(output, selected, latest, max_bytes, timeout):
    path = capture.capture_cycle(selected.strftime("%Y%m%d"), selected.strftime("%H"),
                                 output / "forecasts", max_bytes=max_bytes, timeout=timeout)
    document = json.loads(path.read_text())
    products = document["products"]
    states = [item["state"] for item in products.values()]
    expected = latest and all(item["state"] == "complete" or
                              (item["state"] == "http_error" and item["status"] == 404)
                              for item in products.values())
    result = {"cycleAt": timestamp(selected), "manifest": str(path.relative_to(output)),
              "state": "complete" if states == ["complete", "complete"] else
                       "expected_unpublished" if expected else "collection_failed",
              "products": {kind: {"state": item["state"], "httpStatus": item["status"]}
                           for kind, item in products.items()}, "contractStatus": None, "contractReport": None}
    if result["state"] == "complete":
        report = reader.validate_manifest(path)
        report_path = path.with_name(path.stem + "-contract.json")
        write_manifest(report_path, report)
        result.update({"contractStatus": report["status"], "contractReport": str(report_path.relative_to(output))})
        if report["status"] not in ("consistent", "disagreement"):
            result["state"] = "collection_failed"
    return result


def collect_locked(output, started, overlap, max_bytes, timeout):
    now = datetime.fromisoformat(started.replace("Z", "+00:00"))
    end = now.replace(minute=now.minute // 6 * 6, second=0, microsecond=0)
    begin = end - timedelta(hours=120)
    cycle = now.replace(hour=now.hour // 6 * 6, minute=0, second=0, microsecond=0)
    attempt = uuid.uuid4().hex
    start_path = f"ticks/{attempt}-start.json"
    final_path = f"ticks/{attempt}.json"
    tick = {"schemaVersion": 1, "attemptId": attempt, "startedAt": started,
            "startManifest": start_path, "manifest": final_path, "acquisitionGap": None,
            "observationWindow": {"beginAt": timestamp(begin), "endAt": timestamp(end)},
            "forecastCycles": [timestamp(cycle - timedelta(hours=6 * i)) for i in range(3)],
            "observationStore": "observations", "forecastStore": "forecasts",
            "limits": {"maxBytesPerProduct": max_bytes, "timeoutSeconds": timeout},
            "observations": [], "forecasts": []}
    previous = [json.loads(path.read_text())["startedAt"] for path in (output / "ticks").glob("*-start.json")]
    if previous:
        previous_at = max(previous)
        elapsed = (now - datetime.fromisoformat(previous_at.replace("Z", "+00:00"))).total_seconds()
        if elapsed > 90 * 60:
            tick["acquisitionGap"] = {"previousAttemptAt": previous_at, "elapsedSeconds": elapsed,
                                      "reason": "host_or_scheduler_acquisition_uncertainty"}
    write_manifest(output / start_path, tick)
    tick.update({"state": "skipped_overlap" if overlap else "interrupted", "exitCode": 0 if overlap else 1})
    try:
        if not overlap:
            for station in STATIONS:
                tick["observations"].append(collect_observation(output, attempt, station, begin, end, max_bytes, timeout))
            for i in range(3):
                tick["forecasts"].append(collect_forecast(output, cycle - timedelta(hours=6 * i), i == 0, max_bytes, timeout))
            failed = any(item["state"] != "complete" for item in tick["observations"]) or any(
                item["state"] == "collection_failed" for item in tick["forecasts"])
            unpublished = any(item["state"] == "expected_unpublished" for item in tick["forecasts"])
            tick.update({"state": "collection_failed" if failed else "complete_with_unpublished" if unpublished else "complete",
                         "exitCode": 1 if failed else 0})
    finally:
        tick["finishedAt"] = capture.utc_now()
        write_manifest(output / final_path, tick)
    return tick


def collect_tick(output, *, max_bytes=capture.MAX_BYTES, timeout=60):
    if max_bytes < 1 or not 0 < timeout <= 300:
        raise ValueError("positive byte limit and timeout at most 300 seconds required")
    output = Path(output)
    started = capture.utc_now()
    output.mkdir(parents=True, exist_ok=True)
    with (output / ".collection.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            overlap = False
        except BlockingIOError:
            overlap = True
        return collect_locked(output, started, overlap, max_bytes, timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-bytes", type=int, default=capture.MAX_BYTES)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    result = collect_tick(args.output, max_bytes=args.max_bytes, timeout=args.timeout)
    print(json.dumps(result))
    return result["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
