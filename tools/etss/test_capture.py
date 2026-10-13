import hashlib
import contextlib
import http.client
import io
import json
import tempfile
import runpy
import socket
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import capture


class Response(io.BytesIO):
    status = 200

    def __init__(self, body, length=None):
        super().__init__(body)
        self.headers = {"Content-Length": str(len(body) if length is None else length)}

    def read1(self, size=-1):
        return self.read(size)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def capture(self, responses, **kwargs):
        with patch.object(capture, "open_url", side_effect=responses):
            path = capture.capture_cycle("20261012", "00", self.root, **kwargs)
        return path, json.loads(path.read_text())

    def test_unique_attempts_keep_original_and_revised_bodies(self):
        a, first = self.capture([Response(b"original"), Response(b"csv")])
        b, second = self.capture([Response(b"revised"), Response(b"csv")])
        self.assertNotEqual(a, b)
        self.assertEqual(first["cycleAt"], "2026-10-12T00:00:00Z")
        self.assertFalse(first["atomicPublication"])
        for document in (first, second):
            for item in document["products"].values():
                self.assertLessEqual(item["requestStartedAt"], item["receivedAt"])
                body = (self.root / "bodies" / (item["sha256"] + ".bin")).read_bytes()
                self.assertEqual(hashlib.sha256(body).hexdigest(), item["sha256"])
        self.assertEqual(len(list((self.root / "bodies").iterdir())), 3)
        self.assertEqual(json.loads(a.read_text()), first)

    def test_error_and_missing_pair_keep_http_body(self):
        error = HTTPError("https://nomads.ncep.noaa.gov/", 404, "missing", {}, io.BytesIO(b"not found"))
        _, manifest = self.capture([Response(b"shef"), error])
        self.assertEqual(manifest["products"]["shef"]["state"], "complete")
        item = manifest["products"]["csv"]
        self.assertEqual(item["status"], 404)
        self.assertEqual(item["state"], "http_error")
        self.assertEqual((self.root / "bodies" / (item["sha256"] + ".bin")).read_bytes(), b"not found")

    def test_network_failure_retains_attempt_without_inventing_receipt(self):
        _, manifest = self.capture([URLError("offline"), Response(b"csv")])
        item = manifest["products"]["shef"]
        self.assertEqual(item["state"], "request_error")
        self.assertIsNone(item["receivedAt"])
        self.assertIsNone(item["sha256"])
        self.assertIsNotNone(item["finishedAt"])

    def test_size_limit_and_short_response_retain_partial_bytes(self):
        _, manifest = self.capture([Response(b"abcdef"), Response(b"abc", 10)], max_bytes=4)
        self.assertEqual(manifest["products"]["shef"]["state"], "partial")
        self.assertEqual(manifest["products"]["shef"]["bytes"], 4)
        self.assertEqual(manifest["products"]["csv"]["state"], "partial")
        self.assertIn("Content-Length", manifest["products"]["csv"]["error"])

    def test_read_exception_retains_observed_prefix(self):
        response = Response(b"first")
        response.read = unittest.mock.Mock(side_effect=[b"first", OSError("disconnected")])
        _, manifest = self.capture([response, Response(b"csv")])
        item = manifest["products"]["shef"]
        self.assertEqual(item["state"], "partial")
        self.assertEqual(item["bytes"], 5)
        self.assertIsNotNone(item["responseReceivedAt"])
        self.assertIsNone(item["receivedAt"])

    def test_content_addressed_existing_bytes_cannot_be_overwritten(self):
        digest = hashlib.sha256(b"original").hexdigest()
        (self.root / "bodies").mkdir()
        target = self.root / "bodies" / (digest + ".bin")
        target.write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "existing"):
            self.capture([Response(b"original"), Response(b"csv")])
        self.assertEqual(target.read_bytes(), b"corrupted")

    def test_explicit_date_cycle_and_fixed_origin(self):
        self.assertEqual(capture.product_url("20261012", "18", "csv"),
                         "https://nomads.ncep.noaa.gov/pub/data/nccf/com/petss/prod/etss.20261012/etss.t18z.csv.tar.gz")
        for date, cycle in [("20260230", "00"), ("20261012", "03"), ("../20261012", "00")]:
            with self.assertRaises(ValueError):
                capture.product_url(date, cycle, "csv")
        with self.assertRaises(ValueError):
            capture.product_url("20261012", "00", "petss")

    def test_redirect_is_not_followed(self):
        request = capture.urllib.request.Request(capture.product_url("20261012", "00", "csv"))
        with self.assertRaises(HTTPError) as caught:
            capture.NoRedirect().redirect_request(request, None, 302, "moved", {}, "https://example.com/")
        caught.exception.close()

    def test_interrupt_during_second_request_preserves_first_receipt(self):
        with patch.object(capture, "open_url", side_effect=[Response(b"shef"), KeyboardInterrupt()]):
            with self.assertRaises(KeyboardInterrupt):
                capture.capture_cycle("20261012", "00", self.root)
        records = list((self.root / "records").glob("*-shef.json"))
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0].read_text())["state"], "complete")
        self.assertEqual(len(list((self.root / "records").glob("*-csv-start.json"))), 1)

    def test_elapsed_limit_and_incomplete_read_preserve_partial_receipts(self):
        path = self.root / "records" / "bounded.json"
        with patch.object(capture, "open_url", return_value=Response(b"abc")), \
                patch.object(capture.time, "monotonic", side_effect=[0, 61]):
            item = capture.capture_product("https://nomads.ncep.noaa.gov/", self.root, 20, 60, path)
        self.assertEqual(item["state"], "partial")
        self.assertIsNone(item["receivedAt"])
        response = Response(b"")
        response.read = unittest.mock.Mock(side_effect=http.client.IncompleteRead(b"prefix", 10))
        _, document = self.capture([response, Response(b"csv")])
        self.assertEqual(document["products"]["shef"]["bytes"], 6)
        self.assertEqual(document["products"]["shef"]["state"], "partial")

    def test_invalid_limits_fail_before_network(self):
        for limits in [{"max_bytes": 0}, {"timeout": 0}, {"timeout": 301}]:
            with self.assertRaises(ValueError):
                capture.capture_cycle("20261012", "00", self.root, **limits)

    def test_cli_writes_reviewable_attempt_with_standard_transport(self):
        opener = unittest.mock.Mock()
        opener.open.side_effect = [Response(b"shef"), Response(b"csv")]
        output = io.StringIO()
        with patch.object(capture.urllib.request, "build_opener", return_value=opener), \
                patch.object(sys, "argv", ["capture.py", "--date", "20261012", "--cycles", "00", "--output", str(self.root)]), \
                contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(capture.__file__)), run_name="__main__")
        path = Path(output.getvalue().strip())
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest["products"]["csv"]["state"], "complete")
        self.assertEqual(manifest["products"]["shef"]["bytes"], 4)

    def http_response(self):
        receiver, sender = socket.socketpair()
        receiver.settimeout(0.03)
        self.addCleanup(receiver.close)
        self.addCleanup(sender.close)
        sender.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\nfirst")
        response = http.client.HTTPResponse(receiver)
        response.url = "https://nomads.ncep.noaa.gov/"
        response.begin()
        return response, sender

    def test_real_http_timeout_keeps_available_prefix(self):
        response, sender = self.http_response()
        with patch.object(capture, "open_url", return_value=response):
            item = capture.capture_product("https://nomads.ncep.noaa.gov/", self.root, 100, 0.05,
                                           self.root / "records" / "socket-timeout.json")
        self.assertEqual(item["state"], "partial")
        self.assertEqual(item["bytes"], 5)
        self.assertEqual((self.root / "bodies" / (item["sha256"] + ".bin")).read_bytes(), b"first")

    def test_real_slow_http_body_checks_deadline_between_available_reads(self):
        response, sender = self.http_response()
        stopped = threading.Event()

        def deliver():
            for _ in range(15):
                if stopped.wait(0.01):
                    return
                sender.sendall(b"x")

        thread = threading.Thread(target=deliver)
        thread.start()
        started = time.monotonic()
        try:
            with patch.object(capture, "open_url", return_value=response):
                item = capture.capture_product("https://nomads.ncep.noaa.gov/", self.root, 100, 0.05,
                                               self.root / "records" / "slow-stream.json")
            elapsed = time.monotonic() - started
        finally:
            stopped.set()
            thread.join()
        self.assertLess(elapsed, 0.14)
        self.assertEqual(item["state"], "partial")
        self.assertGreaterEqual(item["bytes"], 5)
        self.assertLess(item["bytes"], 20)

    def test_late_eof_is_not_a_complete_receipt(self):
        response = Response(b"abc")
        with patch.object(capture, "open_url", return_value=response), \
                patch.object(capture.time, "monotonic", side_effect=[0, 0, 1, 2, 61]):
            item = capture.capture_product("https://nomads.ncep.noaa.gov/", self.root, 100, 60,
                                           self.root / "records" / "late-eof.json")
        self.assertEqual(item["state"], "partial")
        self.assertIsNone(item["receivedAt"])
        self.assertEqual(item["bytes"], 3)


if __name__ == "__main__":
    unittest.main()
