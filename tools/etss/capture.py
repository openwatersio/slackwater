"""Finite manual preservation of NOAA deterministic ETSS export attempts."""

import argparse
import hashlib
import http.client
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


ORIGIN = "https://nomads.ncep.noaa.gov"
MAX_BYTES = 16 * 1024 * 1024


def product_url(date, cycle, product):
    if not re.fullmatch(r"\d{8}", date):
        raise ValueError("date must be YYYYMMDD")
    datetime.strptime(date, "%Y%m%d")
    if cycle not in ("00", "06", "12", "18") or product not in ("shef", "csv"):
        raise ValueError("unsupported cycle or product")
    return f"{ORIGIN}/pub/data/nccf/com/petss/prod/etss.{date}/etss.t{cycle}z.{product}.tar.gz"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)


def open_url(url, timeout):
    return urllib.request.build_opener(NoRedirect()).open(url, timeout=timeout)


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def immutable_write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != body:
                raise ValueError(f"existing immutable file differs: {path}")
    finally:
        os.unlink(temporary)


def capture_product(url, output, max_bytes, timeout, record_path):
    record = {"url": url, "requestStartedAt": utc_now(), "responseReceivedAt": None,
              "receivedAt": None, "finishedAt": None, "status": None, "headers": {},
              "sha256": None, "bytes": 0, "state": "request_error", "error": None}
    immutable_write(record_path.with_name(record_path.stem + "-start.json"),
                    (json.dumps(record, indent=2) + "\n").encode())
    deadline = time.monotonic() + timeout
    body = bytearray()
    response = None
    try:
        try:
            response = open_url(url, timeout)
        except urllib.error.HTTPError as error:
            response = error
        record["responseReceivedAt"] = utc_now()
        record["status"] = response.status
        record["headers"] = dict(response.headers.items())
        record["returnedUrl"] = response.geturl() if hasattr(response, "geturl") else url
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError("response exceeded elapsed download limit")
            # Buffered read may wait indefinitely for a full block while a server trickles bytes.
            chunk = response.read1(min(65536, max_bytes - len(body) + 1))
            available = max_bytes - len(body)
            body.extend(chunk[:available])
            if len(chunk) > available:
                raise ValueError("response exceeds byte limit")
            if time.monotonic() > deadline:
                raise TimeoutError("response exceeded elapsed download limit")
            if not chunk:
                record["receivedAt"] = utc_now()
                break
        length = response.headers.get("Content-Length")
        if length is not None and int(length) != len(body):
            raise ValueError("body size differs from Content-Length")
        record["state"] = "complete" if record["status"] == 200 else "http_error"
        if record["state"] == "http_error":
            record["error"] = f"HTTP {record['status']}"
    except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException) as error:
        if isinstance(error, http.client.IncompleteRead):
            body.extend(error.partial[:max_bytes - len(body)])
        record["state"] = "partial" if response is not None else "request_error"
        record["receivedAt"] = None
        record["error"] = f"{type(error).__name__}: {error}"
    finally:
        record["finishedAt"] = utc_now()
        if response is not None:
            response.close()
    if response is not None:
        raw = bytes(body)
        record["sha256"] = hashlib.sha256(raw).hexdigest()
        record["bytes"] = len(raw)
        immutable_write(output / "bodies" / (record["sha256"] + ".bin"), raw)
    immutable_write(record_path, (json.dumps(record, indent=2) + "\n").encode())
    return record


def capture_cycle(date, cycle, output, *, max_bytes=MAX_BYTES, timeout=60):
    urls = {kind: product_url(date, cycle, kind) for kind in ("shef", "csv")}
    if max_bytes < 1 or not 0 < timeout <= 300:
        raise ValueError("positive byte limit and timeout at most 300 seconds required")
    output = Path(output)
    attempt = uuid.uuid4().hex
    manifest = {"schemaVersion": 1, "attemptId": attempt, "date": date, "cycle": cycle,
                "cycleAt": datetime.strptime(date + cycle, "%Y%m%d%H").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "atomicPublication": False, "receiptIsFirstPublication": False,
                "limits": {"maxBytesPerProduct": max_bytes, "timeoutSeconds": timeout},
                "products": {}, "productRecords": {
                    kind: f"records/{attempt}-{kind}.json" for kind in urls}}
    immutable_write(output / f"attempt-{date}-{cycle}-{attempt}-start.json",
                    (json.dumps(manifest, indent=2) + "\n").encode())
    for kind, url in urls.items():
        manifest["products"][kind] = capture_product(url, output, max_bytes, timeout,
                                                     output / manifest["productRecords"][kind])
    path = output / f"attempt-{date}-{cycle}-{attempt}.json"
    immutable_write(path, (json.dumps(manifest, indent=2) + "\n").encode())
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="explicit UTC cycle date YYYYMMDD")
    parser.add_argument("--cycles", nargs="+", choices=("00", "06", "12", "18"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    for cycle in args.cycles:
        print(capture_cycle(args.date, cycle, args.output, max_bytes=args.max_bytes, timeout=args.timeout))


if __name__ == "__main__":
    main()
