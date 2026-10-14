import contextlib
import copy
import gzip
import hashlib
import io
import json
import sys
import unittest
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import reader
import test_reader
from test_reader import START, TITLE, csv_text, shef


class MappingTests(unittest.TestCase):
    setUp = test_reader.ReaderTests.setUp
    manifest = test_reader.ReaderTests.manifest
    replace_product = test_reader.ReaderTests.replace_product

    def inputs(self):
        native = reader.parse_shef(shef())["stations"]["EBSW1"]
        csv = reader.parse_csv(csv_text(count=2221, start=START - timedelta(hours=120)))
        return native, csv

    def mapped(self, native, csv, cycle=START):
        return reader.compare_station(native, csv, cycle, csv_mapping=True)

    def test_constant_bias_uses_csv_clock_and_converts_twl_once(self):
        native, csv = self.inputs()
        original = copy.deepcopy((native, csv))
        report = self.mapped(native, csv)
        mapping = report["mapping"]
        self.assertEqual(mapping["status"], "accepted")
        self.assertEqual(mapping["biasMode"], "constant")
        self.assertEqual(mapping["expectedCsvOffsetHours"], 0)
        self.assertEqual(mapping["biasSupport"]["present"], 79)
        self.assertEqual(len(mapping["forecast"]), 103)
        self.assertEqual(mapping["forecast"][0], {"validAt": "2026-10-12T00:00:00Z", "csvFeet": "1.000", "heightMeters": "0.3048000"})
        self.assertEqual(mapping["forecast"][-1]["validAt"], "2026-10-16T06:00:00Z")
        self.assertEqual((native, csv), original)

    def test_original_dynamic_seattle_runs_use_csv_without_relabeling_shef(self):
        fixtures = Path(__file__).parent / "fixtures"
        cases = [("20261013", "18", "constant", 0, "8.678", "8.438"),
                 ("20261014", "00", "varying", 1, "9.427", "7.463")]
        for date, hour, mode, offset, first, last in cases:
            with self.subTest(date=date):
                prefix = fixtures / f"seattle-{date}-{hour}-full"
                native = reader.parse_shef(prefix.with_suffix(".shef").read_text())["stations"]["EBSW1"]
                csv = reader.parse_csv(gzip.decompress(prefix.with_suffix(".csv.gz").read_bytes()).decode())
                original = copy.deepcopy((native, csv))
                cycle = reader.instant(date + hour, "%Y%m%d%H")
                report = self.mapped(native, csv, cycle)
                mapping = report["mapping"]
                self.assertEqual(mapping["status"], "accepted")
                self.assertEqual(mapping["biasMode"], mode)
                self.assertEqual(mapping["expectedCsvOffsetHours"], offset)
                self.assertEqual(mapping["expectedTime"]["compared"], 102)
                self.assertEqual(mapping["expectedTime"]["disagreements"], [])
                self.assertEqual(mapping["forecast"][0]["csvFeet"], first)
                self.assertEqual(mapping["forecast"][-1]["csvFeet"], last)
                self.assertEqual(mapping["forecast"][0]["validAt"], report["declaredStart"])
                if offset:
                    self.assertEqual(report["status"], "disagreement")
                    self.assertEqual(native["values"][0], Decimal("10.350"))
                    self.assertEqual(mapping["forecast"][0]["heightMeters"], "2.8733496")
                    self.assertGreater(len(report["sameTime"]["disagreements"]), 0)
                self.assertEqual((native, csv), original)
        provenance = json.loads((fixtures / "mapping-provenance.json").read_text())
        for name, record in provenance["fixtures"].items():
            data = (fixtures / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
            text = gzip.decompress(data) if name.endswith(".gz") else data
            self.assertEqual(hashlib.sha256(text).hexdigest(), record["textSha256"])

    def test_early_bias_changes_do_not_misclassify_constant_tail(self):
        native, csv = self.inputs()
        csv["rows"][START]["BIAS"] = Decimal("0.200")
        csv["rows"][START]["TIDE"] = Decimal("0.600")
        self.assertEqual(self.mapped(native, csv)["mapping"]["biasMode"], "constant")
        self.assertEqual(self.mapped(native, csv)["mapping"]["status"], "accepted")

    def test_each_missing_hourly_bias_prevents_classification(self):
        for hour in (24, 25, 102):
            with self.subTest(hour=hour):
                native, csv = self.inputs()
                csv["rows"][START + timedelta(hours=hour)]["BIAS"] = None
                mapping = self.mapped(native, csv)["mapping"]
                self.assertEqual(mapping["status"], "incomplete")
                self.assertEqual(mapping["biasMode"], "unknown")
                self.assertEqual(mapping["forecast"], [])

    def test_missing_forecast_component_or_shef_does_not_become_zero(self):
        for field in ("TWL", "TIDE", "SURGE", "BIAS", "SHEF"):
            with self.subTest(field=field):
                native, csv = self.inputs()
                if field == "SHEF":
                    native["values"][0] = None
                else:
                    csv["rows"][START][field] = None
                mapping = self.mapped(native, csv)["mapping"]
                self.assertEqual(mapping["status"], "incomplete")
                self.assertEqual(mapping["forecast"], [])

    def test_missing_csv_hour_or_history_span_rejects_even_matching_values(self):
        for at in (START, START - timedelta(hours=120), START + timedelta(hours=102)):
            with self.subTest(at=at):
                native, csv = self.inputs()
                del csv["rows"][at]
                # Reparse the original-format rows so cadence accounting is exercised too.
                text = "TIME,TIDE,OB,SURGE,BIAS,TWL\n" + "\n".join(
                    key.strftime("%Y%m%d%H%M") + "," + ",".join(str(row[f]) if row[f] is not None else "9999.000" for f in reader.FIELDS)
                    for key, row in csv["rows"].items())
                mapping = self.mapped(native, reader.parse_csv(text))["mapping"]
                self.assertEqual(mapping["status"], "incomplete")
                self.assertEqual(mapping["forecast"], [])

    def test_unexplained_values_arithmetic_and_wrong_cycle_are_rejected(self):
        for defect in ("native", "arithmetic", "cycle"):
            with self.subTest(defect=defect):
                native, csv = self.inputs()
                cycle = START
                if defect == "native":
                    native["values"][0] = Decimal("1.020")
                elif defect == "arithmetic":
                    csv["rows"][START]["BIAS"] = Decimal("0.120")
                else:
                    cycle += timedelta(hours=6)
                mapping = self.mapped(native, csv, cycle)["mapping"]
                self.assertEqual(mapping["status"], "unexplained")
                self.assertEqual(mapping["forecast"], [])

    def test_varying_bias_cannot_pass_with_only_same_time_agreement(self):
        native, csv = self.inputs()
        at = START + timedelta(hours=25)
        csv["rows"][at].update(BIAS=Decimal("0.200"), TWL=Decimal("1.100"))
        native["values"][25] = Decimal("1.100")
        report = self.mapped(native, csv)
        self.assertEqual(report["status"], "consistent")
        self.assertEqual(report["mapping"]["biasMode"], "varying")
        self.assertEqual(report["mapping"]["status"], "unexplained")
        self.assertEqual(report["mapping"]["forecast"], [])

    def test_printed_rounding_bound_and_empty_observations(self):
        native, csv = self.inputs()
        native["values"][0] = Decimal("1.001")
        self.assertEqual(self.mapped(native, csv)["mapping"]["status"], "accepted")
        native["values"][0] = Decimal("1.002")
        self.assertEqual(self.mapped(native, csv)["mapping"]["status"], "unexplained")

    def test_manifest_and_cli_opt_in_preserve_legacy_diagnostics(self):
        text = shef() + "".join(shef(nws).removeprefix(TITLE) for nws in ("FRDW1", "PTWW1"))
        path = self.manifest(shef_text=text)
        legacy = reader.validate_manifest(path)
        self.assertNotIn("mappingStatus", legacy)
        mapped = reader.validate_manifest(path, csv_mapping=True)
        self.assertEqual(mapped["mappingStatus"], "accepted")
        self.assertFalse(mapped["scoringPermitted"])
        self.assertFalse(mapped["adapterAccepted"])
        self.assertEqual(mapped["mappingContract"]["forecastSource"], "CSV TWL at TIME")
        output = io.StringIO()
        with patch.object(sys, "argv", ["reader.py", str(path), "--csv-mapping"]), contextlib.redirect_stdout(output):
            self.assertEqual(reader.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["mappingStatus"], "accepted")
        path = self.manifest()
        self.assertEqual(reader.validate_manifest(path, csv_mapping=True)["mappingStatus"], "incomplete")
        path = self.manifest(shef_text=text, csv_source=csv_text(count=2221, start=START-timedelta(hours=120), twl="1.020"))
        self.assertEqual(reader.validate_manifest(path, csv_mapping=True)["mappingStatus"], "unexplained")
        document = json.loads(path.read_text())
        document["products"]["csv"]["sha256"] = "a" * 64
        path.write_text(json.dumps(document))
        self.assertEqual(reader.validate_manifest(path, csv_mapping=True)["mappingStatus"], "unsupported")
        path.write_text("invalid JSON")
        with patch.object(sys, "argv", ["reader.py", str(path), "--csv-mapping"]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(reader.main(), 1)


if __name__ == "__main__":
    unittest.main()
