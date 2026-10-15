"""Offline CO-OPS receipt selection for ETSS research, in meters on MLLW."""

import hashlib
import json
import math
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import collect
from reader import instant, iso, require, verified_body, verify_receipt


POLICY = "coops-exact-hour-research-2026-10-15-v1"


def utc(text):
    require(isinstance(text, str), "timestamp must be text")
    at = datetime.fromisoformat(text.replace("Z", "+00:00"))
    require(at.tzinfo is not None and at.utcoffset() == timedelta(0), "timestamp must be UTC")
    return at


def number(text):
    try:
        value = Decimal(text)
        return value if value.is_finite() and math.isfinite(float(value)) else None
    except (InvalidOperation, ValueError):
        return None


def normalize_row(row):
    require(isinstance(row, dict) and all(isinstance(row.get(k), str) for k in ("t", "v", "s", "f", "q")),
            "invalid observation row")
    reasons, count, inferred = [], None, None
    value, sigma, quality = number(row["v"]), number(row["s"]), row["q"]
    if value is None:
        reasons.append("missing_or_nonfinite_height")
    if sigma is None or sigma < 0:
        reasons.append("invalid_sigma")
    if quality not in ("p", "v"):
        reasons.append("unknown_quality")
    flags = row["f"].split(",")
    if len(flags) != 4 or not re.fullmatch(r"\d+", flags[0]) or any(f not in ("0", "1") for f in flags[1:]):
        reasons.append("invalid_flags")
    else:
        # NOAA's first flag is an outlier count for p, but an inferred-value bit for v.
        if quality == "p":
            count = int(flags[0])
        elif quality == "v":
            inferred = flags[0] == "1"
            if flags[0] not in ("0", "1") or inferred:
                reasons.append("inferred_or_invalid_verified_flag")
        if any(f == "1" for f in flags[1:]):
            reasons.append("provider_quality_flag")
    return {"valid": not reasons, "reasons": reasons, "heightMeters": str(value) if not reasons else None,
            "sigmaMeters": str(sigma) if sigma is not None else None, "quality": quality,
            "outlierCount": count, "inferred": inferred, "raw": dict(row)}


def load_receipt(path, station, cutoff):
    path = Path(path)
    with path.open("rb") as stream:
        data = stream.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, "manifest exceeds byte limit")
    doc = json.loads(data)
    require(isinstance(doc, dict) and doc.get("schemaVersion") == 1, "unsupported observation manifest")
    require(doc.get("station") == station and station in collect.STATIONS, "wrong or unsupported station")
    require(doc.get("state") == "complete", "observation capture is incomplete")
    query, record = doc["query"], doc["record"]
    expected = {"product": "water_level", "station": station, "datum": "MLLW", "units": "metric",
                "time_zone": "gmt", "format": "json", "application": "slackwater"}
    require(set(query) == set(expected) | {"begin_date", "end_date"} and
            all(query.get(k) == v for k, v in expected.items()), "unsupported observation request")
    begin, end = (instant(query[key], "%Y%m%d %H:%M") for key in ("begin_date", "end_date"))
    require(begin <= end, "reversed request window")
    require(record.get("state") == "complete" and record.get("status") == 200, "incomplete response")
    verify_receipt(record)
    url = urlsplit(record["url"])
    require(url.scheme == "https" and url.netloc == "api.tidesandcurrents.noaa.gov" and
            url.path == "/api/prod/datagetter" and not url.fragment and
            parse_qs(url.query) == {k: [v] for k, v in query.items()}, "request URL disagrees with manifest")
    require(record.get("returnedUrl", record["url"]) == record["url"], "redirected observation request")
    received = utc(record["receivedAt"])
    receipt = {"manifest": path.name, "manifestSha256": hashlib.sha256(data).hexdigest(),
               "bodySha256": record["sha256"], "receivedAt": iso(received), "rows": None}
    if received > cutoff:
        return receipt
    body = verified_body(path.parent, record)
    collect.observation_diagnostics(body, station, begin, end)
    rows = json.loads(body)["data"]
    require(all(instant(r["t"], "%Y-%m-%d %H:%M") <= received for r in rows), "sample follows receipt")
    receipt["rows"] = [(instant(r["t"], "%Y-%m-%d %H:%M"), normalize_row(r)) for r in rows if r["t"].endswith(":00")]
    return receipt


def select_hourly(paths, station, begin_at, end_at, received_by, *, verified_only=False, receipt_cache=None):
    begin, end, cutoff = utc(begin_at), utc(end_at), utc(received_by)
    require(begin <= end and end - begin <= timedelta(days=370), "invalid hourly window")
    require(not any((at.minute, at.second, at.microsecond) != (0, 0, 0) for at in (begin, end)),
            "window must use exact UTC hours")
    selected, receipts = {}, []
    cache = {} if receipt_cache is None else receipt_cache
    for path in sorted(set(map(Path, paths))):
        try:
            key = (path, station)
            receipt = cache.get(key)
            if receipt is None or (receipt["rows"] is None and utc(receipt["receivedAt"]) <= cutoff):
                receipt = load_receipt(path, station, cutoff)
                cache[key] = receipt
            received = utc(receipt["receivedAt"])
            info = {k: v for k, v in receipt.items() if k != "rows"}
            if received > cutoff:
                receipts.append({**info, "state": "excluded", "reason": "late_receipt"})
                continue
            info.update(state="eligible", acceptedHours=0, rejectedHours=0)
            for at, sample in receipt["rows"]:
                if not begin <= at <= end:
                    continue
                if not sample["valid"] or (verified_only and sample["quality"] != "v"):
                    info["rejectedHours"] += 1
                    continue
                info["acceptedHours"] += 1
                previous = selected.get(at)
                rank = (-received.timestamp(), receipt["manifest"])
                if previous is None or rank < previous[0]:
                    selected[at] = (rank, {**sample, **{k: receipt[k] for k in
                        ("manifest", "manifestSha256", "bodySha256", "receivedAt")}})
            receipts.append(info)
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            receipts.append({"manifest": path.name, "state": "rejected", "reason": str(error)})
    hours = []
    for i in range(int((end - begin).total_seconds() // 3600) + 1):
        at = begin + timedelta(hours=i)
        sample = selected.get(at)
        hours.append({"validAt": iso(at), **(sample[1] if sample else
                     {"heightMeters": None, "reason": "no_eligible_valid_receipt"})})
    return {"policy": POLICY, "station": station, "datum": "MLLW", "units": "meters",
            "receivedBy": iso(cutoff), "verifiedOnly": verified_only, "hours": hours, "receipts": receipts}
