import copy
import hashlib
import importlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode


def row(at="2026-10-14 01:00", **changes):
    return dict({"t": at, "v": "1.234", "s": "0.01", "f": "0,0,0,0", "q": "p"}, **changes)


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(Path(__file__).with_name("observations.py").exists(), "observation normalizer is missing")
        self.obs = importlib.import_module("observations")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def receipt(self, name="one", at="2026-10-14T01:50:00Z", rows=None, **changes):
        raw = json.dumps({"metadata": {"id": "9447130", "name": "Seattle", "lat": "47.6", "lon": "-122.3"},
                          "data": [row()] if rows is None else rows}).encode()
        digest = hashlib.sha256(raw).hexdigest()
        (self.root / "bodies").mkdir(exist_ok=True)
        (self.root / "bodies" / (digest + ".bin")).write_bytes(raw)
        query = {"product": "water_level", "station": "9447130", "begin_date": "20261010 00:00",
                 "end_date": "20261015 23:00", "datum": "MLLW", "units": "metric",
                 "time_zone": "gmt", "format": "json", "application": "slackwater"}
        record = {"state": "complete", "status": 200, "sha256": digest, "bytes": len(raw),
                  **{key: at for key in ("requestStartedAt", "responseReceivedAt", "receivedAt", "finishedAt")},
                  "url": "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + urlencode(query)}
        document = {"schemaVersion": 1, "station": "9447130", "state": "complete", "query": query, "record": record}
        document.update(changes)
        path = self.root / (name + ".json")
        path.write_text(json.dumps(document))
        return path

    def select(self, paths, **kwargs):
        return self.obs.select_hourly(paths, "9447130", "2026-10-14T00:00:00Z", "2026-10-14T02:00:00Z",
                                      "2026-10-14T02:00:00Z", **kwargs)

    def test_quality_distinguishes_outlier_count_from_inference_and_preserves_raw(self):
        raw = row(f="7,0,0,0", s="0.900")
        original = copy.deepcopy(raw)
        sample = self.obs.normalize_row(raw)
        self.assertTrue(sample["valid"])
        self.assertEqual(sample["outlierCount"], 7)
        self.assertIsNone(sample["inferred"])
        self.assertEqual(sample["heightMeters"], "1.234")
        self.assertEqual(sample["raw"], original)
        self.assertEqual(raw, original)
        inferred = self.obs.normalize_row(row(q="v", f="1,0,0,0"))
        self.assertFalse(inferred["valid"])
        self.assertTrue(inferred["inferred"])
        self.assertIsNone(inferred["outlierCount"])
        self.assertTrue(self.obs.normalize_row(row(q="v"))["valid"])

    def test_bad_values_sigma_quality_and_flags_remain_rejected(self):
        for changes in ({"v": ""}, {"v": "NaN"}, {"v": "Infinity"}, {"v": "bad"}, {"s": ""},
                        {"s": "-0.1"}, {"s": "NaN"}, {"q": "x"}, {"f": "-1,0,0,0"},
                        {"f": "0,0,0"}, {"f": "0,0,0,2"}, {"q": "v", "f": "2,0,0,0"},
                        {"f": "0,1,0,0"}, {"f": "0,0,1,0"}, {"f": "0,0,0,1"}):
            with self.subTest(changes=changes):
                result = self.obs.normalize_row(row(**changes))
                self.assertFalse(result["valid"])
                self.assertIsNone(result["heightMeters"])
                self.assertTrue(result["reasons"])
        self.assertEqual(self.obs.normalize_row(row(v="-1.25"))["heightMeters"], "-1.25")

    def test_extreme_numeric_tokens_cannot_partially_accept_a_rejected_receipt(self):
        path = self.receipt(rows=[row("2026-10-14 00:00"), row(f="9" * 5000 + ",0,0,0")])
        report = self.select([path])
        self.assertFalse(report["hours"][0]["heightMeters"] is not None and report["receipts"][0]["state"] == "rejected")
        self.assertIsNone(report["hours"][0]["heightMeters"])
        self.assertIsNone(report["hours"][1]["heightMeters"])
        self.assertFalse(self.obs.normalize_row(row(v="1e999"))["valid"])

    def test_cache_cannot_leak_later_revision_into_an_earlier_decision(self):
        early = self.receipt("early", rows=[row(v="1.2")])
        late = self.receipt("late", at="2026-10-14T03:00:00Z", rows=[row(v="9")])
        cache = {}
        for cutoff, expected in (("2026-10-14T02:00:00Z", "1.2"), ("2026-10-14T04:00:00Z", "9"),
                                 ("2026-10-14T02:00:00Z", "1.2")):
            result = self.obs.select_hourly([early, late], "9447130", "2026-10-14T01:00:00Z",
                                           "2026-10-14T01:00:00Z", cutoff, receipt_cache=cache)
            self.assertEqual(result["hours"][0]["heightMeters"], expected)

    def test_recorded_verified_fixture_keeps_exact_hour_heights(self):
        fixture = json.loads((Path(__file__).parents[2] / "fixtures/residuals-noaa-friday-harbor.json").read_text())
        rows = fixture["response"]["data"]
        hourly = [r for r in rows if r["t"].endswith(":00")]
        samples = [self.obs.normalize_row(r) for r in hourly]
        self.assertTrue(samples)
        self.assertTrue(all(s["valid"] and s["quality"] == "v" for s in samples))
        self.assertEqual([s["heightMeters"] for s in samples], [r["v"] for r in hourly])

    def test_latest_valid_receipt_before_decision_with_deterministic_ties(self):
        old = self.receipt("old", "2026-10-14T01:30:00Z")
        later = self.receipt("b", rows=[row(v="1.5")])
        tied = self.receipt("a", rows=[row(v="1.6")])
        rejected = self.receipt("rejected", "2026-10-14T01:59:00Z", [row(v="99", f="0,1,0,0")])
        future = self.receipt("future", "2026-10-14T02:00:00.000001Z", [row(v="9")])
        report = self.select([future, later, rejected, old, tied])
        self.assertEqual([s["heightMeters"] for s in report["hours"]], [None, "1.6", None])
        self.assertEqual(report["hours"][1]["manifest"], "a.json")
        self.assertEqual(report["hours"][1]["receivedAt"], "2026-10-14T01:50:00Z")
        self.assertEqual(report["hours"][1]["bodySha256"], json.loads(tied.read_text())["record"]["sha256"])
        self.assertTrue(any(r.get("reason") == "late_receipt" for r in report["receipts"]))
        self.assertEqual(report, self.select([tied, old, later, future, rejected]))

    def test_exact_hours_do_not_average_or_fill_and_truth_requires_verified(self):
        path = self.receipt(rows=[row("2026-10-14 00:54", v="8"), row(), row("2026-10-14 01:06", v="9")])
        self.assertEqual([s["heightMeters"] for s in self.select([path])["hours"]], [None, "1.234", None])
        self.assertTrue(all(s["heightMeters"] is None for s in self.select([path], verified_only=True)["hours"]))
        path = self.receipt(at="2026-10-14T02:00:00Z", rows=[row(q="v")])
        self.assertEqual(self.select([path], verified_only=True)["hours"][1]["heightMeters"], "1.234")

    def test_hash_identity_receipt_and_grid_fail_closed(self):
        for defect in ("hash", "units", "url", "station", "clock", "duplicate", "offgrid", "outside", "schema"):
            with self.subTest(defect=defect):
                path = self.receipt(rows=[row(), row()] if defect == "duplicate" else
                                    [row("2026-10-14 01:01")] if defect == "offgrid" else
                                    [row("2026-10-09 01:00")] if defect == "outside" else None)
                doc = json.loads(path.read_text())
                if defect == "hash":
                    (self.root / "bodies" / (doc["record"]["sha256"] + ".bin")).write_bytes(b"changed")
                elif defect == "units":
                    doc["query"]["units"] = "english"
                elif defect == "url":
                    doc["record"]["url"] += "&units=english"
                elif defect == "station":
                    doc["station"] = "9449880"
                elif defect == "clock":
                    doc["record"]["finishedAt"] = "2026-10-14T01:00:00Z"
                elif defect == "schema":
                    doc["schemaVersion"] = 2
                path.write_text(json.dumps(doc))
                report = self.select([path])
                self.assertTrue(all(s["heightMeters"] is None for s in report["hours"]))
                self.assertEqual(report["receipts"][0]["state"], "rejected")

    def test_bad_manifest_or_incomplete_capture_is_disclosed(self):
        for content in ("[]", "{", "null"):
            path = self.root / "bad.json"
            path.write_text(content)
            report = self.select([path])
            self.assertEqual(report["receipts"][0]["state"], "rejected")
        path = self.receipt(state="partial")
        self.assertEqual(self.select([path])["receipts"][0]["state"], "rejected")
        with self.assertRaises(ValueError):
            self.obs.select_hourly([], "9447130", "2026-10-14T00:01:00Z", "2026-10-14T02:00:00Z", "bad")


if __name__ == "__main__":
    unittest.main()
