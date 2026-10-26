import hashlib
import contextlib
import io
import json
import tarfile
import tempfile
import runpy
import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import reader


START = datetime(2026, 10, 12, tzinfo=timezone.utc)
TITLE = ":SHEF ENCODED 1 HOUR STORM SURGE + TIDE GUIDANCE\n:WATER LEVEL VALUES REFERENCED TO MLLW IN FEET\n:PROVIDED BY DOC/NOAA/NWS/OSTI/MDL\n"


def shef(station="EBSW1", value="1.000"):
    result = TITLE + f".E {station} 20261012 Z DC202610120453/DH0000/HMIFV/DIH01\n"
    for index in range(9):
        result += f".E{index + 1} " + "/".join([value] * min(12, 102 - index * 12)) + "/\n"
    return result


def csv_text(count=1021, twl="1.000", tide="0.700", surge="0.200", bias="0.100", start=START):
    rows = ["TIME,TIDE,OB,SURGE,BIAS,TWL"]
    for index in range(count):
        timestamp = (start + timedelta(minutes=6 * index)).strftime("%Y%m%d%H%M")
        rows.append(f"{timestamp},{tide},9999.000,{surge},{bias},{twl}")
    return "\n".join(rows) + "\n"


def archive(members):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        for name, body, kind in members:
            data = body.encode()
            item = tarfile.TarInfo(name)
            item.type = kind
            item.size = len(data) if kind == tarfile.REGTYPE else 0
            tar.addfile(item, io.BytesIO(data) if item.size else None)
    return out.getvalue()


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "bodies").mkdir()

    def manifest(self, shef_text=None, csv_source=None):
        products = {}
        for product, members in [
            ("shef", [("etss.20261012/shef.etss.t00z.totalwater.west", shef_text or shef(), tarfile.REGTYPE)]),
            ("csv", [(f"etss.20261012/t00z.csv/{station}.csv", csv_source or csv_text(count=2221, start=START - timedelta(hours=120)), tarfile.REGTYPE)
                     for station in reader.STATIONS.values()]),
        ]:
            body = archive(members)
            digest = hashlib.sha256(body).hexdigest()
            (self.root / "bodies" / (digest + ".bin")).write_bytes(body)
            products[product] = {"state": "complete", "status": 200, "sha256": digest,
                                 "bytes": len(body), "requestStartedAt": "2026-10-13T00:00:00Z",
                                 "responseReceivedAt": "2026-10-13T00:00:01Z", "receivedAt": "2026-10-13T00:00:02Z",
                                 "finishedAt": "2026-10-13T00:00:03Z",
                                 "url": f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/petss/prod/etss.20261012/etss.t00z.{product}.tar.gz"}
        path = self.root / "attempt.json"
        path.write_text(json.dumps({"schemaVersion": 1, "date": "20261012", "cycle": "00",
                                   "cycleAt": "2026-10-12T00:00:00Z", "products": products}))
        return path

    def test_first_value_is_at_dh_and_rolls_calendar_year(self):
        text = shef().replace("20261012 Z DC202610120453/DH0000", "20261231 Z DC202701010453/DH1800")
        parsed = reader.parse_shef(text)["stations"]["EBSW1"]
        self.assertEqual(parsed["start"].isoformat(), "2026-12-31T18:00:00+00:00")
        self.assertEqual(parsed["createdAt"].isoformat(), "2027-01-01T04:53:00+00:00")
        self.assertEqual(parsed["values"][0], Decimal("1.000"))
        self.assertEqual(len(parsed["values"]), 102)

    def test_identity_datum_utc_parameter_and_continuation_are_strict(self):
        for text in [shef().replace("STORM SURGE + TIDE GUIDANCE", "P-ETSS PROBABILISTIC GUIDANCE"),
                     shef().replace("MLLW", "NAVD88"), shef().replace("FEET", "METERS"),
                     shef().replace(" Z DC", " P DC"), shef().replace("HMIFV", "HGIFV"),
                     shef().replace("DIH01", "DIH02"), shef().replace(".E2 ", ".E3 "),
                     shef() + shef(), shef().replace("1.000", "NaN", 1)]:
            with self.subTest(text=text[:80]), self.assertRaises(reader.ContractError):
                reader.parse_shef(text)

    def test_missing_shef_and_csv_values_remain_missing(self):
        self.assertIsNone(reader.parse_shef(shef(value="M"))["stations"]["EBSW1"]["values"][0])
        self.assertIsNone(reader.parse_shef(shef(value="-9999"))["stations"]["EBSW1"]["values"][0])
        parsed = reader.parse_csv(csv_text(count=1, twl="9999.000"))
        self.assertIsNone(parsed["rows"][START]["TWL"])
        self.assertIsNone(parsed["rows"][START]["OB"])

    def test_csv_gaps_are_reported_without_filling(self):
        text = csv_text(count=3)
        lines = text.splitlines()
        parsed = reader.parse_csv("\n".join([lines[0], lines[1], lines[3]]))
        self.assertEqual(parsed["missingRows"], 1)
        self.assertEqual(len(parsed["rows"]), 2)
        for bad in [text.replace("TWL", "OTHER"), text + lines[-1] + "\n",
                    text.replace("202610120006", "202610120007"), text.replace("0.700", "Infinity")]:
            with self.assertRaises(reader.ContractError):
                reader.parse_csv(bad)

    def test_archive_rejects_unsafe_duplicate_link_and_resource_excess(self):
        cases = [[("../escape", "x", tarfile.REGTYPE)], [("/absolute", "x", tarfile.REGTYPE)],
                 [("a", "x", tarfile.REGTYPE), ("a", "x", tarfile.REGTYPE)],
                 [("a", "", tarfile.SYMTYPE)], [("a/../b", "x", tarfile.REGTYPE)],
                 [("a\\b", "x", tarfile.REGTYPE)]]
        for members in cases:
            with self.subTest(members=members), self.assertRaises(reader.ContractError):
                reader.read_archive(archive(members), {"a"})
        body = archive([("a", "abc", tarfile.REGTYPE), ("b", "abc", tarfile.REGTYPE)])
        for limits in [{"max_member_bytes": 2}, {"max_members": 1}, {"max_archive_bytes": 100}]:
            with self.assertRaises(reader.ContractError):
                reader.read_archive(body, {"a"}, **limits)

    def test_hash_corruption_and_incomplete_pair_are_explicit(self):
        path = self.manifest()
        manifest = json.loads(path.read_text())
        digest = manifest["products"]["csv"]["sha256"]
        (self.root / "bodies" / (digest + ".bin")).write_bytes(b"corrupt")
        report = reader.validate_manifest(path)
        self.assertEqual(report["status"], "unsupported")
        self.assertIn("hash", report["products"]["csv"]["error"])
        manifest["products"]["csv"] = {"state": "http_error", "status": 404}
        path.write_text(json.dumps(manifest))
        self.assertEqual(reader.validate_manifest(path)["status"], "incomplete")

    def test_native_same_time_consistency_and_station_absence(self):
        report = reader.validate_manifest(self.manifest())
        row = report["stations"]["EBSW1"]
        self.assertEqual(row["status"], "consistent")
        self.assertEqual(row["sameTime"]["compared"], 102)
        self.assertEqual(row["sameTime"]["maxAbsFeet"], "0.000")
        self.assertEqual(row["arithmetic"]["exceptions"], [])
        self.assertEqual(report["stations"]["FRDW1"]["status"], "absent")
        self.assertEqual(report["status"], "incomplete")

    def test_arithmetic_exception_is_not_hidden_or_bias_added_twice(self):
        report = reader.validate_manifest(self.manifest(csv_source=csv_text(twl="1.003")))
        row = report["stations"]["EBSW1"]
        self.assertEqual(row["status"], "disagreement")
        self.assertGreater(len(row["arithmetic"]["exceptions"]), 0)
        self.assertEqual(row["arithmetic"]["exceptions"][0]["errorFeet"], "0.003")
        self.assertEqual(row["arithmetic"]["toleranceFeet"], "0.002")

    def test_real_seattle_example_keeps_declared_clock_disagreement(self):
        fixtures = Path(__file__).parent / "fixtures"
        native = reader.parse_shef((fixtures / "seattle-20261012-12.shef").read_text())
        csv = reader.parse_csv((fixtures / "seattle-20261012-12.csv").read_text())
        report = reader.compare_station(native["stations"]["EBSW1"], csv, START + timedelta(hours=12))
        self.assertEqual(report["status"], "disagreement")
        self.assertEqual(report["declaredStart"], "2026-10-12T12:00:00Z")
        self.assertGreater(Decimal(report["sameTime"]["maxAbsFeet"]), Decimal("0.002"))
        self.assertNotIn("shift", json.dumps(report).lower())
        provenance = json.loads((fixtures / "provenance.json").read_text())
        for name, metadata in provenance["fixtures"].items():
            self.assertEqual(hashlib.sha256((fixtures / name).read_bytes()).hexdigest(), metadata["sha256"])

    def test_non_target_hmifx_is_excluded_and_reported(self):
        text = shef() + shef("HRVC1").removeprefix(TITLE).replace("HMIFV", "HMIFX")
        parsed = reader.parse_shef(text)
        self.assertNotIn("HRVC1", parsed["stations"])
        self.assertEqual(parsed["excludedStations"], {"HRVC1": "HMIFX"})
        with self.assertRaises(reader.ContractError):
            reader.parse_shef(shef().replace("HMIFV", "HMIFX"))

    def test_original_seattle_control_matches_without_completing_excerpt(self):
        fixtures = Path(__file__).parent / "fixtures"
        native = reader.parse_shef((fixtures / "seattle-20261012-00.shef").read_text())
        csv = reader.parse_csv((fixtures / "seattle-20261012-00.csv").read_text())
        report = reader.compare_station(native["stations"]["EBSW1"], csv, START)
        self.assertEqual(report["sameTime"]["maxAbsFeet"], "0.000")
        self.assertEqual(report["sameTime"]["compared"], 4)
        self.assertEqual(report["sameTime"]["disagreements"], [])
        self.assertEqual(report["status"], "incomplete")
        self.assertFalse(report["csv"]["observedSpanComplete"])

    def test_truncated_csv_is_incomplete_even_when_every_shef_time_exists(self):
        report = reader.compare_station(reader.parse_shef(shef())["stations"]["EBSW1"],
                                        reader.parse_csv(csv_text()), START)
        self.assertEqual(report["sameTime"]["compared"], 102)
        self.assertEqual(report["status"], "incomplete")
        self.assertFalse(report["csv"]["observedSpanComplete"])

    def test_invalid_receipt_metadata_is_unsupported(self):
        path = self.manifest()
        manifest = json.loads(path.read_text())
        manifest["products"]["csv"]["receivedAt"] = None
        path.write_text(json.dumps(manifest))
        self.assertEqual(reader.validate_manifest(path)["status"], "unsupported")
        manifest["products"]["csv"]["receivedAt"] = "2026-10-12T00:00:00Z"
        path.write_text(json.dumps(manifest))
        self.assertEqual(reader.validate_manifest(path)["status"], "unsupported")

    def replace_product(self, path, kind, body):
        document = json.loads(path.read_text())
        digest = hashlib.sha256(body).hexdigest()
        (self.root / "bodies" / (digest + ".bin")).write_bytes(body)
        document["products"][kind].update(sha256=digest, bytes=len(body))
        path.write_text(json.dumps(document))

    def test_manifest_reports_absent_member_and_unsupported_native_or_csv(self):
        path = self.manifest()
        self.replace_product(path, "shef", archive([("etss.20261012/other", "x", tarfile.REGTYPE)]))
        report = reader.validate_manifest(path)
        self.assertEqual(report["status"], "incomplete")
        self.assertIn("absent", report["products"]["shef"]["error"])
        path = self.manifest(shef_text=shef().replace("HMIFV", "HMIFX"))
        self.assertEqual(reader.validate_manifest(path)["status"], "unsupported")
        path = self.manifest(csv_source=csv_text().replace("TWL", "UNKNOWN"))
        self.assertEqual(reader.validate_manifest(path)["stations"]["EBSW1"]["status"], "unsupported")

    def test_parser_rejects_invalid_dates_bulletin_lines_and_corrupt_archives(self):
        for text in [shef().replace("20261012", "20260230"), shef() + "unrecognized bulletin text\n"]:
            with self.assertRaises(reader.ContractError):
                reader.parse_shef(text)
        for body in [b"invalid", archive([("a", "x", tarfile.REGTYPE)])[:-12]]:
            with self.assertRaises(reader.ContractError):
                reader.read_archive(body, {"a"})

    def test_declared_timing_flags_remain_visible(self):
        native = reader.parse_shef(shef())["stations"]["EBSW1"]
        report = reader.compare_station(native, reader.parse_csv(csv_text()), START + timedelta(hours=6))
        self.assertEqual(report["status"], "disagreement")
        self.assertEqual(report["flags"], ["declared_start_differs_from_requested_cycle", "bulletin_creation_precedes_requested_cycle"])

    def test_receipt_rejects_invalid_zone_and_date(self):
        path = self.manifest()
        for invalid in ["invalid", "2026-10-13T00:00:02", "2026-10-13T00:00:02-01:00"]:
            document = json.loads(path.read_text())
            document["products"]["csv"]["receivedAt"] = invalid
            path.write_text(json.dumps(document))
            self.assertEqual(reader.validate_manifest(path)["status"], "unsupported")

    def test_cli_consistent_run_keeps_scoring_and_adapter_closed(self):
        text = shef() + "".join(shef(nws).removeprefix(TITLE) for nws in ("FRDW1", "PTWW1"))
        path = self.manifest(shef_text=text)
        output = io.StringIO()
        with patch.object(sys, "argv", ["reader.py", str(path)]), contextlib.redirect_stdout(output), \
                self.assertRaises(SystemExit) as caught:
            runpy.run_path(str(Path(reader.__file__)), run_name="__main__")
        self.assertEqual(caught.exception.code, 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "consistent")
        self.assertFalse(report["scoringPermitted"])
        self.assertFalse(report["adapterAccepted"])
        path.write_text("invalid JSON")
        output = io.StringIO()
        with patch.object(sys, "argv", ["reader.py", str(path)]), contextlib.redirect_stdout(output):
            self.assertEqual(reader.main(), 1)
        self.assertEqual(json.loads(output.getvalue())["status"], "unsupported")

    def test_corrupt_concatenated_gzip_has_structured_archive_error(self):
        body = archive([("a", "x", tarfile.REGTYPE)]) + b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03\x06\x00\x00\x00"
        with self.assertRaises(reader.ContractError):
            reader.read_archive(body, {"a"})
        path = self.manifest()
        self.replace_product(path, "csv", body)
        self.assertEqual(reader.validate_manifest(path)["status"], "unsupported")

    def test_oversized_csv_field_has_structured_station_error(self):
        text = "TIME,TIDE,OB,SURGE,BIAS,TWL\n202610120000," + "1" * 131073 + ",1.000,1.000,1.000,1.000\n"
        with self.assertRaises(reader.ContractError):
            reader.parse_csv(text)
        path = self.manifest(csv_source=text)
        self.assertEqual(reader.validate_manifest(path)["stations"]["EBSW1"]["status"], "unsupported")


if __name__ == "__main__":
    unittest.main()
