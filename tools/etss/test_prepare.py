import contextlib
import hashlib
import importlib
import io
import json
import runpy
import sys
import tarfile
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import reader
from test_collect import forecast
from test_reader import archive
import test_observations
from test_observations import row


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(Path(__file__).with_name("prepare.py").exists(), "decision input preparation is missing")
        self.p = importlib.import_module("prepare")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "forecasts" / "bodies").mkdir(parents=True)
        (self.root / "observations").mkdir()
        self.decision = "2026-10-14T02:00:00Z"

    def pair(self, name="a", at="2026-10-14T01:30:00Z", cycle="18", date="20261013", disagree=False):
        products = {}
        for kind in ("shef", "csv"):
            url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/petss/prod/etss.{date}/etss.t{cycle}z.{kind}.tar.gz"
            body = forecast(url, disagreement=disagree)
            digest = hashlib.sha256(body).hexdigest()
            (self.root / "forecasts" / "bodies" / (digest + ".bin")).write_bytes(body)
            products[kind] = {"state": "complete", "status": 200, "sha256": digest, "bytes": len(body), "url": url,
                              **{k: at for k in ("requestStartedAt", "responseReceivedAt", "receivedAt", "finishedAt")}}
        doc = {"schemaVersion": 1, "date": date, "cycle": cycle,
               "cycleAt": reader.iso(reader.instant(date + cycle, "%Y%m%d%H")), "products": products}
        path = self.root / "forecasts" / ("attempt-" + name + ".json")
        path.write_text(json.dumps(doc))
        return path

    def tides(self):
        start = self.p.utc(self.decision) - timedelta(hours=96)
        series = {reader.iso(start + timedelta(hours=h)): 1.0 for h in range(121)}
        doc = {"schemaVersion": 1, "datum": "MLLW", "units": "meters", "nodeCorrections": "iho",
               "provenance": {"fixture": "synthetic constant tide"},
               "stations": {s: series for s in reader.STATIONS.values()}}
        path = self.root / "tides.json"
        path.write_text(json.dumps(doc))
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_earliest_pair_uses_both_receipts_no_older_cycle_or_late_revision(self):
        b = self.pair("b")
        a = self.pair("a")
        late = self.pair("late", "2026-10-14T02:00:00.000001Z")
        older = self.pair("older", cycle="12")
        result = self.p.choose_forecast([b, late, older, a], "9447130", self.decision)
        self.assertEqual(result["manifest"], "attempt-a.json")
        self.assertEqual(result["forecast"]["2026-10-14T05:00:00Z"], 0.3048)
        self.assertEqual(len(result["surge"]), 97)
        self.assertAlmostEqual(result["surge"][0], 0.06096)
        self.assertIsNone(self.p.choose_forecast([late, older], "9447130", self.decision)["manifest"])
        doc = json.loads(a.read_text())
        doc["products"]["csv"].update({k: "2026-10-14T03:00:00Z" for k in
                                       ("requestStartedAt", "responseReceivedAt", "receivedAt", "finishedAt")})
        a.write_text(json.dumps(doc))
        self.assertIsNone(self.p.choose_forecast([a], "9447130", self.decision)["manifest"])

    def test_earliest_complete_but_unexplained_mapping_cannot_be_replaced_by_later_revision(self):
        first = self.pair("first", disagree=True)
        second = self.pair("second", at="2026-10-14T01:45:00Z")
        result = self.p.choose_forecast([second, first], "9447130", self.decision)
        self.assertEqual(result["manifest"], "attempt-first.json")
        self.assertEqual(result["forecast"], {})
        self.assertIsNone(result["surge"])
        self.assertEqual(result["reason"], "mapping_unexplained")

    def test_an_unrelated_station_error_does_not_remove_a_valid_station_forecast(self):
        path = self.pair()
        doc = json.loads(path.read_text())
        record = doc["products"]["csv"]
        root = self.root / "forecasts"
        names = {f"etss.20261013/t18z.csv/{s}.csv" for s in reader.STATIONS.values()}
        members = reader.read_archive(reader.verified_body(root, record), names)
        members['etss.20261013/t18z.csv/9449880.csv'] = members['etss.20261013/t18z.csv/9449880.csv'].replace('TIME', 'NOT_TIME')
        body = archive([(k, v, tarfile.REGTYPE) for k, v in members.items()])
        digest = hashlib.sha256(body).hexdigest()
        (root / 'bodies' / (digest + '.bin')).write_bytes(body)
        record.update(sha256=digest, bytes=len(body))
        path.write_text(json.dumps(doc))
        result = self.p.choose_forecast([path], "9447130", self.decision)
        self.assertIsNone(result["reason"])
        self.assertEqual(result["forecast"]["2026-10-14T05:00:00Z"], 0.3048)
        self.assertEqual(self.p.choose_forecast([path], "9449880", self.decision)["forecast"], {})

    def test_preparation_keeps_missing_targets_independent_and_never_uses_future_input(self):
        # Use real receipt parsing: future verification can supply truth but cannot supply an anchor.
        helper = test_observations.ObservationTests()
        helper.root = self.root / "observations"
        helper.receipt("attempt-input", rows=[row(v="1.2")])
        helper.receipt("attempt-truth", at="2026-10-15T00:00:00Z",
                       rows=[row(v="9", q="v"), row("2026-10-14 05:00", v="1.4", q="v"),
                             row("2026-10-14 08:00", v="1.5", q="v")])
        self.pair()
        path, digest = self.tides()
        report = self.p.prepare(self.root, path, digest, self.decision, "2026-10-16T00:00:00Z")
        seattle = report["stations"]["9447130"]
        self.assertEqual(len(seattle["history"]["hours"]), 96)
        self.assertEqual(seattle["history"]["hours"][-1]["validAt"], "2026-10-14T01:00:00Z")
        self.assertEqual([v["truth"] is not None for v in seattle["targets"]], [True, True, False, False])
        for target in seattle["targets"]:
            self.assertAlmostEqual(target["methods"]["persistence"]["heightMeters"], 1.2)
            self.assertTrue(target["methods"]["mean24"]["fallback"])
            self.assertFalse(target["methods"]["fullTwl"]["fallback"])
        self.assertFalse(report["productionAccepted"])
        self.assertEqual(report["tideSha256"], digest)
        self.assertTrue(report["codeHashes"])
        self.assertFalse(report["scoresComputed"])

    def test_truth_maturity_uses_fixed_per_sample_cutoff_and_keeps_preliminary_status(self):
        helper = test_observations.ObservationTests()
        helper.root = self.root / "observations"
        helper.receipt("attempt-truth", at="2026-10-14T05:50:00Z", rows=[row("2026-10-14 05:00", v="1.4")])
        helper.receipt("attempt-revised", at="2026-10-15T05:00:00.000001Z", rows=[row("2026-10-14 05:00", v="8", q="v")])
        path, digest = self.tides()
        early = self.p.prepare(self.root, path, digest, self.decision, "2026-10-15T04:59:59Z")
        self.assertIsNone(early["stations"]["9447130"]["targets"][0]["truth"])
        self.assertEqual(early["stations"]["9447130"]["targets"][0]["truthReason"], "truth_not_mature")
        mature = self.p.prepare(self.root, path, digest, self.decision, "2026-10-16T00:00:00Z")
        sample = mature["stations"]["9447130"]["targets"][0]["truth"]
        self.assertEqual(sample["heightMeters"], "1.4")
        self.assertEqual(sample["quality"], "p")

    def test_bad_inputs_fail_closed_and_cli_does_not_overwrite_evidence(self):
        path, digest = self.tides()
        (self.root / "observations" / "attempt-broken.json").write_text("bad JSON")
        for bad_digest, decision, truth in (("0" * 64, self.decision, "2026-10-15T00:00:00Z"),
                                           (digest, "2026-10-14T03:00:00Z", "2026-10-15T00:00:00Z"),
                                           (digest, self.decision, "2026-10-13T00:00:00Z")):
            with self.assertRaises(ValueError):
                self.p.prepare(self.root, path, bad_digest, decision, truth)
        args = ["prepare.py", "--data", str(self.root), "--tides", str(path), "--tides-sha256", digest,
                "--decision", self.decision, "--truth-as-of", "2026-10-15T00:00:00Z"]
        before = {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(self.p.main(), 0)
        self.assertEqual(json.loads(out.getvalue())["decisionAt"], self.decision)
        self.assertEqual(json.loads(out.getvalue())["unassignedObservationManifests"], ["attempt-broken.json"])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})
        args[args.index("--tides-sha256") + 1] = "bad"
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as error:
            runpy.run_path(str(Path(self.p.__file__)), run_name="__main__")
        self.assertEqual(error.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
