import contextlib
import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
import runpy
from datetime import timedelta
from urllib.parse import urlencode
from pathlib import Path
from unittest.mock import patch

import report
import test_prepare
import test_observations
from observations import utc
from test_scoring import case


def calibration_source(contract):
    dates = [d.date().isoformat() for d in report.calendar("calibration", None, None)]
    return {"policy": report.POLICY, "phase": "calibration", "truthAsOf": "2026-12-03T13:00:00Z",
            "generatedAt": "2026-12-03T13:30:00Z", "firstDecision": "2026-11-01T02:00:00Z",
            "lastDecision": "2026-11-30T02:00:00Z", "contract": contract,
            "cases": {s: {str(h): [case(d, .3) for d in dates] for h in report.HORIZONS} for s in report.STATIONS},
            "calibratedRadii": {m: {str(h): .6 if m == "unchanged" else .3 for h in report.HORIZONS} for m in report.METHODS}}


class ReportTest(unittest.TestCase):
    def test_calendars_are_complete_and_development_cannot_overlap_formal_cohorts(self):
        self.assertEqual(len(report.calendar("calibration", None, None)), 30)
        self.assertEqual(len(report.calendar("confirmation", None, None)), 59)
        self.assertEqual(len(report.calendar("development", "2026-10-14", "2026-10-15")), 2)
        for phase, first, last in (("development", "2026-10-15", "2026-10-14"),
                                   ("development", "2026-11-01", "2026-11-02"),
                                   ("confirmation", "2026-12-04", "2026-12-05")):
            with self.assertRaises(ValueError):
                report.calendar(phase, first, last)

    def test_widths_require_all_gauges_matching_contract_and_real_freeze_before_confirmation(self):
        source = calibration_source({"source": "abc"})
        with patch.object(report, "now", return_value=utc("2026-12-03T14:00:00Z")):
            frozen = report.freeze_widths(source)
        self.assertEqual(frozen["frozenAt"], "2026-12-03T14:00:00Z")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "widths.json"
            path.write_text(json.dumps(frozen))
            original = Path(tmp) / "calibration.json"
            original.write_text(json.dumps(source))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(report.read_widths(path, digest, source["contract"], original), frozen)
            for bad_hash, contract in (("bad", source["contract"]), (digest, {"source": "changed"})):
                with self.assertRaises(ValueError):
                    report.read_widths(path, bad_hash, contract, original)
            for defect in ("missing_report", "revised_report", "manual_radius", "missing_gauge", "narrow_calendar"):
                with self.subTest(defect=defect):
                    candidate, changed = copy.deepcopy(frozen), copy.deepcopy(source)
                    if defect == "revised_report":
                        changed["generatedAt"] = "2026-12-03T13:31:00Z"
                    elif defect == "manual_radius":
                        candidate["radii"]["fullTwl"]["24"] = 99
                    elif defect == "missing_gauge":
                        del changed["cases"]["9447130"]
                    elif defect == "narrow_calendar":
                        changed["cases"]["9447130"]["24"].pop()
                    original.write_text(json.dumps(changed))
                    if defect in ("missing_gauge", "narrow_calendar"):
                        candidate["calibrationReportSha256"] = report.document_hash(changed)
                    path.write_text(json.dumps(candidate))
                    with self.assertRaises(ValueError):
                        report.read_widths(path, report.digest(path), source["contract"],
                                           None if defect == "missing_report" else original)
        for change in ({"phase": "development"}, {"truthAsOf": "2026-12-03T12:59:59Z"},
                       {"calibratedRadii": {m: {str(h): None for h in report.HORIZONS} for m in report.METHODS}}):
            with patch.object(report, "now", return_value=utc("2026-12-03T14:00:00Z")), self.assertRaises(ValueError):
                report.freeze_widths({**source, **change})
        with patch.object(report, "now", return_value=utc("2026-12-04T02:00:00Z")), self.assertRaises(ValueError):
            report.freeze_widths(source)

    def test_report_real_receipts_fallback_and_missing_truth_without_evidence_mutation(self):
        helper = test_prepare.PreparationTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        tide, digest = helper.tides()
        helper.pair()
        observation = test_observations.ObservationTests()
        observation.root = helper.root / "observations"
        observation.receipt("attempt-target", at="2026-10-14T06:00:00Z",
                            rows=[test_observations.row("2026-10-14 05:00", v="0.4")])
        pin = helper.root / "pin.json"
        pin.write_text(json.dumps({"tideBundleSha256": digest, "files": {}}))
        snapshot = "2026-10-16T12:00:00Z"
        before = {str(p): p.read_bytes() for p in helper.root.rglob("*") if p.is_file()}
        with patch.object(report, "now", return_value=utc(snapshot)):
            result = report.build(helper.root, tide, "development", snapshot, "2026-10-14", "2026-10-14", pin_path=pin)
        self.assertFalse(result["productionAccepted"])
        self.assertEqual(result["acceptance"]["fullTwl"], "development_only")
        self.assertEqual(len(result["cases"]["9447130"]["3"]), 1)
        cell = result["scores"]["9447130"]["3"]["fullTwl"]
        self.assertEqual(cell["overall"]["count"], 1)
        self.assertAlmostEqual(cell["overall"]["mae"], .0952)
        self.assertEqual(cell["missingTruth"], {})
        self.assertEqual(result["scores"]["9447130"]["6"]["fullTwl"]["missingTruth"], {"no_valid_truth_receipt": 1})
        self.assertIn("Development", report.markdown(result))
        self.assertEqual(before, {str(p): p.read_bytes() for p in helper.root.rglob("*") if p.is_file()})
        with self.assertRaises(ValueError):
            report.verify_pin(tide, Path(__file__).with_name("evaluation-pin.json"))

    def test_formal_verdict_never_accepts_partial_calendar_or_development(self):
        passed = {s: {str(h): {m: "pass" for m in report.METHODS} for h in report.HORIZONS} for s in report.STATIONS}
        self.assertEqual(report.verdict("development", False, passed)["fullTwl"], "development_only")
        self.assertEqual(report.verdict("confirmation", False, passed)["fullTwl"], "inconclusive")
        self.assertEqual(report.verdict("confirmation", True, passed)["fullTwl"], "pass")
        passed["9447130"]["3"]["fullTwl"] = "fail"
        self.assertEqual(report.verdict("confirmation", True, passed)["fullTwl"], "fail")
        passed["9447130"]["3"]["fullTwl"] = "inconclusive"
        self.assertEqual(report.verdict("confirmation", True, passed)["fullTwl"], "inconclusive")

    def test_cli_formats_outputs_rejects_overwrite_and_handles_invalid_input(self):
        helper = test_prepare.PreparationTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        tide, digest = helper.tides()
        pin = helper.root / "pin.json"
        pin.write_text(json.dumps({"tideBundleSha256": digest, "files": {}}))
        contract = report.verify_pin(tide, pin)
        args = ["report.py", "--data", str(helper.root), "--tides", str(tide), "--phase", "development",
                "--first", "2026-10-14", "--last", "2026-10-14", "--truth-as-of", "2026-10-15T02:00:00Z"]
        with tempfile.TemporaryDirectory() as output:
            path = Path(output) / "report.md"
            with patch.object(sys, "argv", args + ["--markdown", str(path)]), patch.object(report, "verify_pin", return_value=contract), contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(report.main(), 0)
            self.assertTrue(path.read_text().startswith("Development"))
            self.assertEqual(json.loads(out.getvalue())["phase"], "development")
            for extra in (["--markdown", str(path)], ["--markdown", str(helper.root / "forbidden.md")],
                          ["--freeze-widths", str(Path(output) / "widths.json")]):
                with patch.object(sys, "argv", args + extra), patch.object(report, "verify_pin", return_value=contract), contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(report.main(), 1)
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as error:
            runpy.run_path(report.__file__, run_name="__main__")
        self.assertEqual(error.exception.code, 1)

    def test_acquisition_keeps_failures_gaps_and_interrupted_attempts_separate(self):
        with tempfile.TemporaryDirectory() as tmp:
            ticks = Path(tmp) / "ticks"
            ticks.mkdir()
            base = {"startedAt": "2026-10-14T02:00:00Z", "finishedAt": "2026-10-14T02:01:00Z",
                    "state": "collection_failed", "acquisitionGap": {"reason": "host_or_scheduler_acquisition_uncertainty"}}
            (ticks / "done.json").write_text(json.dumps(base))
            (ticks / "done-start.json").write_text(json.dumps(base))
            (ticks / "partial-start.json").write_text(json.dumps(base))
            (ticks / "future.json").write_text(json.dumps({**base, "startedAt": "2026-10-16T00:00:00Z"}))
            (ticks / "running.json").write_text(json.dumps({**base, "finishedAt": "2026-10-16T00:00:00Z"}))
            (ticks / "bad.json").write_text("bad")
            result = report.acquisition(tmp, utc("2026-10-15T00:00:00Z"))
            self.assertEqual(result["states"], {"collection_failed": 1})
            self.assertEqual(result["recordedGapCount"], 1)
            self.assertEqual(len(result["unfinishedAttempts"]), 2)
            self.assertEqual(len(result["rejectedManifests"]), 1)

    def test_full_formal_calendars_keep_every_missing_date_and_require_widths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            start = utc("2026-10-27T00:00:00Z")
            series = {report.iso(start + timedelta(hours=h)): 1. for h in range(2500)}
            tide = root / "tides.json"
            tide.write_text(json.dumps({"schemaVersion": 1, "datum": "MLLW", "units": "meters", "nodeCorrections": "iho",
                "provenance": {"synthetic": True}, "stations": {s: series for s in report.STATIONS}}))
            pin = root / "pin.json"
            pin.write_text(json.dumps({"files": {}, "tideBundleSha256": report.digest(tide)}))
            with patch.object(report, "now", return_value=utc("2027-02-04T00:00:00Z")), patch.object(report, "PIN", pin):
                calibration = report.build(root, tide, "calibration", "2026-12-03T13:00:00Z", pin_path=pin)
                self.assertEqual(len(calibration["cases"]["9447130"]["24"]), 30)
                self.assertIsNone(calibration["calibratedRadii"]["fullTwl"]["24"])
                self.assertEqual(calibration["acceptance"]["fullTwl"], "calibration_only")
                with self.assertRaises(ValueError):
                    report.build(root, tide, "confirmation", "2027-02-04T00:00:00Z", pin_path=pin)
                source = calibration_source(calibration["contract"])
                with patch.object(report, "now", return_value=utc("2026-12-03T14:00:00Z")):
                    widths = report.freeze_widths(source)
                source_path = root / "calibration.json"
                source_path.write_text(json.dumps(source))
                path = root / "widths.json"
                path.write_text(json.dumps(widths))
                result = report.build(root, tide, "confirmation", "2027-02-04T00:00:00Z", pin_path=pin,
                                      widths_path=path, widths_hash=report.digest(path), calibration_path=source_path)
                self.assertEqual(len(result["cases"]["9447130"]["24"]), 59)
                self.assertEqual(result["acceptance"]["fullTwl"], "inconclusive")
                self.assertTrue(result["calendarMature"])

    def test_bounded_evidence_view_matches_unfiltered_preparation_and_reuses_parsing(self):
        helper = test_prepare.PreparationTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        tide, tide_hash = helper.tides()
        helper.pair()
        observation = test_observations.ObservationTests()
        observation.root = helper.root / "observations"
        observation.receipt("attempt-current")
        observation.receipt("attempt-truth", at="2026-10-14T06:00:00Z", rows=[test_observations.row("2026-10-14 05:00")])
        observation.receipt("attempt-late", at="2026-10-17T00:00:00Z")
        index = report.evidence_index(helper.root)
        decision = utc(helper.decision)
        obs, forecasts = report.decision_paths(index, decision)
        self.assertEqual(len(obs), 2)
        cache = {s: {} for s in report.STATIONS}
        original = report.prepare.prepare(helper.root, tide, tide_hash, helper.decision, "2026-10-16T12:00:00Z")
        with patch.object(report.labels.observations, "load_receipt", wraps=report.labels.observations.load_receipt) as load:
            for _ in range(2):
                bounded = report.prepare.prepare(helper.root, tide, tide_hash, helper.decision, "2026-10-16T12:00:00Z",
                    observation_paths=obs, forecast_paths=forecasts, receipt_caches=cache)
            self.assertLessEqual(load.call_count, 3)
        for s in report.STATIONS:
            self.assertEqual(original["stations"][s]["history"]["hours"], bounded["stations"][s]["history"]["hours"])
            self.assertEqual(original["stations"][s]["model"], bounded["stations"][s]["model"])
            for a, b in zip(original["stations"][s]["targets"], bounded["stations"][s]["targets"]):
                for k in ("truth", "truthReason", "methods"):
                    self.assertEqual(a[k], b[k])

    def test_view_discloses_bad_metadata_and_prunes_expired_cache_entries(self):
        helper = test_prepare.PreparationTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        tide, _ = helper.tides()
        tide_doc = json.loads(tide.read_text())
        for series in tide_doc["stations"].values():
            for h in range(25, 49):
                series[report.iso(utc(helper.decision) + timedelta(hours=h))] = 1.
        tide.write_text(json.dumps(tide_doc))
        pin = helper.root / "pin.json"
        pin.write_text(json.dumps({"files": {}, "tideBundleSha256": report.digest(tide)}))
        observation = test_observations.ObservationTests()
        observation.root = helper.root / "observations"
        path = observation.receipt("attempt-old", at="2026-10-10T03:00:00Z", rows=[test_observations.row("2026-10-10 02:00")])
        doc = json.loads(path.read_text())
        doc["query"].update(begin_date="20261010 02:00", end_date="20261010 02:00")
        doc["record"]["url"] = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + urlencode(doc["query"])
        path.write_text(json.dumps(doc))
        (observation.root / "attempt-invalid.json").write_text("bad")
        (observation.root / "attempt-ignored-start.json").write_text("bad")
        index = report.evidence_index(helper.root)
        self.assertEqual(len(index["rejectedManifests"]), 1)
        with patch.object(report, "now", return_value=utc("2026-10-16T03:00:00Z")):
            result = report.build(helper.root, tide, "development", "2026-10-16T03:00:00Z", "2026-10-14", "2026-10-15", pin_path=pin)
        self.assertEqual(result["inputs"][0]["stations"]["9447130"]["history"]["hours"][0]["heightMeters"], "1.234")
        self.assertEqual(len(result["evidenceIndex"]["rejectedManifests"]), 1)


if __name__ == "__main__":
    unittest.main()
