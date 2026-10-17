"""Offline contract checks for retained deterministic ETSS export pairs."""

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import tarfile
import zlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath


STATIONS = {"FRDW1": "9449880", "PTWW1": "9444900", "EBSW1": "9447130"}
TITLE = ":SHEF ENCODED 1 HOUR STORM SURGE + TIDE GUIDANCE"
DATUM = ":WATER LEVEL VALUES REFERENCED TO MLLW IN FEET"
PROVIDER = ":PROVIDED BY DOC/NOAA/NWS/OSTI/MDL"
FIELDS = ("TIDE", "OB", "SURGE", "BIAS", "TWL")
MAX_BODY_BYTES = 16 * 1024 * 1024
MAPPING_CONTRACT = {
    "id": "noaa-confirmed-csv-time-2026-10-14-v1",
    "source": "https://github.com/openwatersio/slackwater/issues/401#issuecomment-6170503674",
    "forecastSource": "CSV TWL at TIME",
    "scope": "Three West gauges; observed October 2026 export layout",
}


class ContractError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def instant(text, pattern):
    try:
        return datetime.strptime(text, pattern).replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise ContractError(f"invalid UTC timestamp: {text}") from error


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


class BoundedStream:
    def __init__(self, source, limit):
        self.source = source
        self.limit = limit
        self.count = 0

    def read(self, size=-1):
        remaining = self.limit - self.count
        size = remaining + 1 if size < 0 else min(size, remaining + 1)
        result = self.source.read(size)
        self.count += len(result)
        require(self.count <= self.limit, "archive exceeds decompressed byte limit")
        return result


def read_archive(body, wanted, *, max_member_bytes=1024 * 1024,
                 max_members=4096, max_archive_bytes=128 * 1024 * 1024):
    require(len(body) <= MAX_BODY_BYTES, "archive exceeds compressed byte limit")
    result, seen = {}, set()
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as compressed:
            bounded = BoundedStream(compressed, max_archive_bytes)
            with tarfile.open(fileobj=bounded, mode="r|") as archive:
                for item in archive:
                    name = item.name
                    path = PurePosixPath(name)
                    require(name and not path.is_absolute() and "\\" not in name
                            and all(part not in (".", "..", "") for part in name.rstrip("/").split("/")),
                            f"unsafe archive member: {name}")
                    normalized = str(path)
                    require(normalized not in seen, f"duplicate archive member: {name}")
                    seen.add(normalized)
                    require(len(seen) <= max_members, "archive exceeds member count limit")
                    require(item.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE)
                            and not item.sparse, f"unsupported archive member type: {name}")
                    require(0 <= item.size <= max_member_bytes, f"archive member exceeds byte limit: {name}")
                    if name in wanted and item.isfile():
                        data = archive.extractfile(item).read(max_member_bytes + 1)
                        require(len(data) == item.size, f"truncated archive member: {name}")
                        result[name] = data.decode("ascii")
            while bounded.read(65536):
                pass
    except (OSError, EOFError, tarfile.TarError, UnicodeError, zlib.error) as error:
        raise ContractError(f"invalid gzip/tar archive: {error}") from error
    return result


def height(text, *, shef=False):
    token = text.strip()
    if token in (("M", "-9999", "-9999.000") if shef else ("9999.000",)):
        return None
    require(re.fullmatch(r"[+-]?\d+\.\d{3}", token), f"unsupported height or precision: {token}")
    value = Decimal(token)
    require(abs(value) < 100, f"height outside observed bounded contract: {token}")
    return value


def parse_shef(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    declarations = [line for line in lines if line.startswith(":")]
    require(declarations == [TITLE, DATUM, PROVIDER], "unsupported deterministic identity, units or datum declaration")
    stations, excluded, seen, current, continuation = {}, {}, set(), None, 0
    for line in lines:
        if line.startswith(":") or re.fullmatch(r"[A-Z0-9]{6} [A-Z0-9]{4} [A-Z0-9]+ \d{6}", line):
            continue
        if line.startswith(".E "):
            match = re.fullmatch(r"\.E (\w+) (\d{8}) Z DC(\d{12})/DH(\d{4})/(HMIF[VX])/DIH01", line)
            require(match, "unsupported SHEF UTC, parameter or cadence header")
            station, date, created, clock, parameter = match.groups()
            require(station not in seen, f"duplicate SHEF station: {station}")
            seen.add(station)
            require(parameter == "HMIFV" or station not in STATIONS, f"unsupported selected station parameter: {station}")
            current = {"header": line, "start": instant(date + clock, "%Y%m%d%H%M"),
                       "createdAt": instant(created, "%Y%m%d%H%M"), "values": []}
            if parameter == "HMIFV":
                stations[station] = current
            else:
                excluded[station] = parameter
            continuation = 0
        elif line.startswith(".E"):
            match = re.fullmatch(r"\.E(\d+)\s+(.*)", line)
            require(match and current is not None, "orphan or malformed SHEF continuation")
            require(int(match[1]) == continuation + 1, "missing or unordered SHEF continuation")
            continuation += 1
            tokens = match[2].split("/")
            if not tokens[-1].strip():
                tokens.pop()
            require(tokens, "empty SHEF continuation")
            current["values"].extend(height(token, shef=True) for token in tokens)
        else:
            raise ContractError(f"unsupported SHEF line: {line}")
    require(stations, "no SHEF stations")
    for station, row in stations.items():
        require(len(row["values"]) == 102, f"expected 102 hourly SHEF values: {station}")
    return {"title": TITLE, "provider": PROVIDER, "datum": "MLLW", "units": "feet",
            "timeZone": "UTC", "parameter": "HMIFV", "cadence": "DIH01", "stations": stations,
            "excludedStations": excluded}


def parse_csv(text):
    try:
        table = list(csv.reader(io.StringIO(text)))
    except csv.Error as error:
        raise ContractError(f"invalid CSV: {error}") from error
    header = table[0] if table else []
    require([field.strip() for field in header] == ["TIME", *FIELDS], "unsupported CSV columns")
    rows, previous, missing = {}, None, 0
    for record in table[1:]:
        require(len(record) == 6, "unsupported CSV row width")
        timestamp = record[0].strip()
        require(re.fullmatch(r"\d{12}", timestamp), "unsupported CSV timestamp")
        at = instant(timestamp, "%Y%m%d%H%M")
        require(at.minute % 6 == 0, "CSV time off six-minute UTC grid")
        if previous is not None:
            delta = int((at - previous).total_seconds())
            require(delta > 0 and delta % 360 == 0, "duplicate, unordered or off-grid CSV times")
            missing += delta // 360 - 1
        previous = at
        rows[at] = dict(zip(FIELDS, (height(value) for value in record[1:])))
    require(rows, "empty CSV series")
    return {"rows": rows, "missingRows": missing}


def compare_station(native, csv_series, cycle, *, csv_mapping=False):
    rows = csv_series["rows"]
    compared, missing, max_error, disagreements = 0, 0, Decimal("0.000"), []
    for index, value in enumerate(native["values"]):
        at = native["start"] + timedelta(hours=index)
        other = rows.get(at, {}).get("TWL")
        if value is None or other is None:
            missing += 1
            continue
        compared += 1
        error = value - other
        max_error = max(max_error, abs(error))
        if abs(error) > Decimal("0.001"):
            disagreements.append({"validAt": iso(at), "shefFeet": str(value),
                                  "csvFeet": str(other), "errorFeet": str(error)})
    arithmetic, skipped, exceptions, arithmetic_max = 0, 0, [], Decimal("0.000")
    for at, row in rows.items():
        if any(row[name] is None for name in ("TIDE", "SURGE", "BIAS", "TWL")):
            skipped += 1
            continue
        arithmetic += 1
        error = row["TWL"] - row["TIDE"] - row["SURGE"] - row["BIAS"]
        arithmetic_max = max(arithmetic_max, abs(error))
        # Four independently rounded printed values contribute at most half a millifoot each.
        if abs(error) > Decimal("0.002"):
            exceptions.append({"validAt": iso(at), "errorFeet": str(error)})
    flags = []
    if native["start"] != cycle:
        flags.append("declared_start_differs_from_requested_cycle")
    if native["createdAt"] < cycle:
        flags.append("bulletin_creation_precedes_requested_cycle")
    expected_start, expected_end = cycle - timedelta(hours=120), cycle + timedelta(hours=102)
    span_complete = min(rows) == expected_start and max(rows) == expected_end and not csv_series["missingRows"]
    status = "disagreement" if disagreements or exceptions or flags else (
        "incomplete" if missing or not span_complete or not arithmetic else "consistent")
    result = {"status": status, "flags": flags, "declaredStart": iso(native["start"]),
            "declaredEnd": iso(native["start"] + timedelta(hours=len(native["values"]) - 1)),
            "bulletinCreatedAt": iso(native["createdAt"]), "parameter": "HMIFV",
            "datum": "MLLW", "units": "feet", "timeZone": "UTC", "printedDecimals": 3,
            "sameTime": {"compared": compared, "missing": missing, "maxAbsFeet": str(max_error),
                         "toleranceFeet": "0.001", "disagreements": disagreements},
            "csv": {"rows": len(rows), "missingRows": csv_series["missingRows"],
                    "start": iso(min(rows)), "end": iso(max(rows)), "observedSpanComplete": span_complete,
                    "expectedStart": iso(expected_start), "expectedEnd": iso(expected_end),
                    "declarationSource": "paired SHEF and observed October 2026 export contract"},
            "arithmetic": {"formula": "TWL = TIDE + SURGE + BIAS", "compared": arithmetic,
                           "missingComponents": skipped, "maxAbsFeet": str(arithmetic_max),
                           "toleranceFeet": "0.002", "exceptions": exceptions}}
    if csv_mapping:
        result["mapping"] = map_csv_forecast(native, csv_series, cycle, result)
    return result


def map_csv_forecast(native, csv_series, cycle, diagnostics):
    rows = csv_series["rows"]
    hours = [cycle + timedelta(hours=i) for i in range(103)]
    # The early bias blends observations; the audited branch signature uses +24h onward (#401).
    bias_values = [rows.get(at, {}).get("BIAS") for at in hours[24:]]
    present = sum(value is not None for value in bias_values)
    mode = "unknown" if present != 79 else "constant" if len(set(bias_values)) == 1 else "varying"
    offset = None if mode == "unknown" else int(mode == "varying")
    comparison = {"compared": 0, "missing": 0, "maxAbsFeet": "0.000",
                  "toleranceFeet": "0.001", "disagreements": []}
    maximum = Decimal("0.000")
    if offset is not None:
        for i, value in enumerate(native["values"]):
            declared = native["start"] + timedelta(hours=i)
            # NOAA confirms varying FFT bias mislabels SHEF; CSV TIME stays authoritative (#401).
            csv_at = declared + timedelta(hours=offset)
            other = rows.get(csv_at, {}).get("TWL")
            if value is None or other is None:
                comparison["missing"] += 1
                continue
            comparison["compared"] += 1
            error = value - other
            maximum = max(maximum, abs(error))
            if abs(error) > Decimal("0.001"):
                comparison["disagreements"].append({"shefDeclaredAt": iso(declared),
                    "csvValidAt": iso(csv_at), "shefFeet": str(value), "csvFeet": str(other),
                    "errorFeet": str(error)})
    comparison["maxAbsFeet"] = str(maximum)
    missing_components = [iso(at) for at in hours if any(
        rows.get(at, {}).get(field) is None for field in ("TIDE", "SURGE", "BIAS", "TWL"))]
    unexplained = bool(diagnostics["flags"] or diagnostics["arithmetic"]["exceptions"]
                       or comparison["disagreements"])
    incomplete = (mode == "unknown" or comparison["compared"] != 102
                  or not diagnostics["csv"]["observedSpanComplete"] or bool(missing_components))
    status = "unexplained" if unexplained else "incomplete" if incomplete else "accepted"
    forecast = []
    if status == "accepted":
        forecast = [{"validAt": iso(at), "csvFeet": str(rows[at]["TWL"]),
                     "heightMeters": str(rows[at]["TWL"] * Decimal("0.3048"))} for at in hours]
    return {"status": status, "biasMode": mode, "expectedCsvOffsetHours": offset,
            "biasSupport": {"start": iso(hours[24]), "end": iso(hours[-1]),
                            "expected": 79, "present": present, "cadenceHours": 1},
            "expectedTime": comparison, "missingForecastComponentsAt": missing_components,
            "forecastSource": "CSV TWL at TIME", "datum": "MLLW", "forecast": forecast}


def verified_body(root, record):
    digest = record.get("sha256", "")
    require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest), "invalid body hash")
    path = root / "bodies" / (digest + ".bin")
    require(not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), "unsafe body path")
    with path.open("rb") as stream:
        body = stream.read(MAX_BODY_BYTES + 1)
    require(len(body) <= MAX_BODY_BYTES, "body exceeds byte limit")
    require(hashlib.sha256(body).hexdigest() == digest, "body hash mismatch")
    require(record.get("bytes") == len(body), "body length differs from manifest")
    return body


def verify_receipt(record):
    times = []
    for key in ("requestStartedAt", "responseReceivedAt", "receivedAt", "finishedAt"):
        text = record.get(key)
        require(isinstance(text, str), f"missing capture timestamp: {key}")
        try:
            at = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as error:
            raise ContractError(f"invalid capture timestamp: {key}") from error
        require(at.tzinfo is not None and at.utcoffset() == timedelta(0), f"capture timestamp must be UTC: {key}")
        times.append(at)
    require(times == sorted(times), "capture receipt times are not monotonic")


def validate_manifest(path, *, csv_mapping=False):
    path = Path(path)
    with path.open("rb") as stream:
        data = stream.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, "manifest exceeds byte limit")
    manifest = json.loads(data)
    require(manifest.get("schemaVersion") == 1, "unsupported manifest schema")
    date, hour = manifest.get("date", ""), manifest.get("cycle", "")
    require(isinstance(date, str) and re.fullmatch(r"\d{8}", date) and hour in ("00", "06", "12", "18"),
            "unsupported manifest date or cycle")
    cycle = instant(date + hour, "%Y%m%d%H")
    require(manifest.get("cycleAt") == iso(cycle), "manifest cycle timestamp disagrees")
    report = {"status": "incomplete", "manifest": str(path), "cycleAt": iso(cycle),
              "scope": "West: Friday Harbor, Port Townsend, Seattle; native export consistency only",
              "scoringPermitted": False, "adapterAccepted": False, "receiptIsFirstPublication": False,
              "atomicPublication": False, "products": {}, "stations": {}}
    if csv_mapping:
        report["mappingContract"] = dict(MAPPING_CONTRACT)
    selected, errors, incomplete = {}, False, False
    prefix = f"etss.{date}/"
    names = {"shef": {prefix + f"shef.etss.t{hour}z.totalwater.west"},
             "csv": {prefix + f"t{hour}z.csv/{station}.csv" for station in STATIONS.values()}}
    for kind in ("shef", "csv"):
        record = manifest.get("products", {}).get(kind, {})
        report["products"][kind] = {key: record.get(key) for key in (
            "state", "status", "url", "returnedUrl", "sha256", "requestStartedAt",
            "responseReceivedAt", "receivedAt", "finishedAt", "headers", "error")}
        if record.get("state") != "complete" or record.get("status") != 200:
            incomplete = True
            continue
        try:
            verify_receipt(record)
            expected_url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/petss/prod/etss.{date}/etss.t{hour}z.{kind}.tar.gz"
            require(record.get("url") == expected_url, "unsupported product origin or identity URL")
            selected[kind] = read_archive(verified_body(path.parent, record), names[kind])
        except (ContractError, OSError) as error:
            errors = True
            report["products"][kind]["error"] = str(error)
    native = None
    if "shef" in selected:
        name = next(iter(names["shef"]))
        if name not in selected["shef"]:
            incomplete = True
            report["products"]["shef"]["error"] = "West totalwater member absent"
        else:
            try:
                native = parse_shef(selected["shef"][name])
                report["declarations"] = {key: value for key, value in native.items() if key != "stations"}
                report["declarations"]["region"] = "west"
            except ContractError as error:
                errors = True
                report["products"]["shef"]["error"] = str(error)
    for nws, station in STATIONS.items():
        row = {"stationId": station, "status": "unsupported" if errors else "incomplete"}
        if native is not None and "csv" in selected:
            csv_name = prefix + f"t{hour}z.csv/{station}.csv"
            if nws not in native["stations"] or csv_name not in selected["csv"]:
                row["status"] = "absent"
                incomplete = True
            else:
                try:
                    row.update(compare_station(native["stations"][nws], parse_csv(selected["csv"][csv_name]), cycle,
                                               csv_mapping=csv_mapping))
                except ContractError as error:
                    row.update(status="unsupported", error=str(error))
                    errors = True
        report["stations"][nws] = row
    statuses = {row["status"] for row in report["stations"].values()}
    report["status"] = ("unsupported" if errors else "disagreement" if "disagreement" in statuses
                        else "incomplete" if incomplete or statuses != {"consistent"} else "consistent")
    if csv_mapping:
        mappings = {row.get("mapping", {}).get("status", "incomplete") for row in report["stations"].values()}
        report["mappingStatus"] = ("unsupported" if errors else "unexplained" if "unexplained" in mappings
                                   else "incomplete" if incomplete or mappings != {"accepted"} else "accepted")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--csv-mapping", action="store_true",
                        help="validate NOAA-confirmed mapping and emit hourly CSV TWL in meters")
    args = parser.parse_args()
    try:
        report = validate_manifest(args.manifest, csv_mapping=args.csv_mapping)
    except (ContractError, OSError, ValueError, TypeError, AttributeError) as error:
        report = {"status": "unsupported", "error": str(error), "scoringPermitted": False,
                  "adapterAccepted": False}
    print(json.dumps(report, indent=2))
    if args.csv_mapping:
        return 0 if report.get("mappingStatus") == "accepted" else 1
    return 0 if report["status"] == "consistent" else 1


if __name__ == "__main__":
    raise SystemExit(main())
