import contextlib
import fcntl
import io
import json
import runpy
import sys
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

import capture
from test_capture import Response
from test_reader import TITLE, archive, csv_text, shef


def observation(station, **changes):
    document = {"metadata": {"id": station, "name": "Gauge", "lat": "48.5", "lon": "-123.0"},
                "data": [{"t": "2026-10-13 00:00", "v": "1.23", "s": "0.01", "f": "1,0,0,1", "q": "p"},
                         {"t": "2026-10-13 00:06", "v": "1.24", "s": "0.01", "f": "0,0,0,0", "q": "v"}]}
    document.update(changes)
    return json.dumps(document).encode()


def forecast(url, disagreement=False):
    date = url.split("/etss.")[1][:8]
    cycle = url.split("/etss.t")[1][:2]
    at = datetime.strptime(date + cycle, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if ".shef." in url:
        text = TITLE + "".join(shef(station).removeprefix(TITLE) for station in ("EBSW1", "FRDW1", "PTWW1"))
        text = text.replace("20261012 Z DC202610120453/DH0000", f"{date} Z DC{date}{cycle}53/DH{cycle}00")
        return archive([(f"etss.{date}/shef.etss.t{cycle}z.totalwater.west", text, tarfile.REGTYPE)])
    return archive([(f"etss.{date}/t{cycle}z.csv/{station}.csv",
                     csv_text(count=2221, start=at - timedelta(hours=120), twl="1.003" if disagreement else "1.000"),
                     tarfile.REGTYPE) for station in ("9449880", "9444900", "9447130")])


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def tick(self, *, at="2026-10-13T00:11:12Z", responses=None, **kwargs):
        import collect
        requests = []

        def transport(url, timeout):
            requests.append(url)
            if responses is not None:
                value = next(responses)
                if isinstance(value, BaseException):
                    raise value
                return value
            station = parse_qs(urlparse(url).query).get("station")
            return Response(observation(station[0]) if station else forecast(url))

        with patch.object(capture, "open_url", side_effect=transport), \
                patch.object(capture, "utc_now", return_value=at):
            summary = collect.collect_tick(self.root, **kwargs)
        return summary, requests

    def test_finite_actual_utc_tick_preserves_query_and_nine_request_order(self):
        # Wrong clock rounding, missing gauges, extra calls or forecasts first breaks acquisition.
        self.assertTrue((Path(__file__).with_name("collect.py")).exists(), "finite collector is missing")
        summary, requests = self.tick()
        self.assertEqual(summary["state"], "complete")
        self.assertEqual(summary["startedAt"], "2026-10-13T00:11:12Z")
        self.assertEqual(summary["finishedAt"], "2026-10-13T00:11:12Z")
        self.assertEqual(len(requests), 9)
        for station, url in zip(("9449880", "9444900", "9447130"), requests[:3]):
            self.assertEqual(urlparse(url).netloc, "api.tidesandcurrents.noaa.gov")
            self.assertEqual(parse_qs(urlparse(url).query), {
                "product": ["water_level"], "station": [station], "begin_date": ["20261008 00:06"],
                "end_date": ["20261013 00:06"], "datum": ["MLLW"], "units": ["metric"],
                "time_zone": ["gmt"], "format": ["json"],
                "application": ["slackwater"]})
        self.assertIn("etss.20261013/etss.t00z.shef", requests[3])
        self.assertIn("etss.20261012/etss.t18z.csv", requests[6])
        self.assertIn("etss.20261012/etss.t12z.csv", requests[8])
        self.assertIsNone(summary["acquisitionGap"])
        start = json.loads((self.root / summary["startManifest"]).read_text())
        self.assertNotIn("finishedAt", start)
        item = summary["observations"][0]
        manifest = json.loads((self.root / item["manifest"]).read_text())
        self.assertEqual(manifest["rowCount"], 2)
        self.assertEqual(manifest["latestSampleAt"], "2026-10-13T00:06:00Z")
        body = self.root / "observations" / "bodies" / (manifest["record"]["sha256"] + ".bin")
        self.assertEqual(json.loads(body.read_bytes())["data"][0]["f"], "1,0,0,1")

    def test_revisions_and_elapsed_gaps_preserve_all_attempts(self):
        first, _ = self.tick()
        original = (self.root / first["manifest"]).read_bytes()
        second, _ = self.tick(at="2026-10-13T01:41:13Z")
        self.assertNotEqual(first["attemptId"], second["attemptId"])
        self.assertEqual(second["acquisitionGap"], {"previousAttemptAt": "2026-10-13T00:11:12Z",
                                                   "elapsedSeconds": 5401.0,
                                                   "reason": "host_or_scheduler_acquisition_uncertainty"})
        self.assertEqual((self.root / first["manifest"]).read_bytes(), original)
        third, _ = self.tick(at="2026-10-13T03:11:13Z")
        self.assertIsNone(third["acquisitionGap"])
        bodies = list((self.root / "observations" / "bodies").glob("*.bin"))
        self.assertEqual(len(bodies), 3)
        self.assertEqual(len(list((self.root / "observations" / "records").glob("*-start.json"))), 9)

    def test_observation_error_http200_wrong_metadata_and_cadence_remain_raw(self):
        import collect
        row = {"t": "2026-10-13 00:06", "v": "1.23", "s": "0.01", "f": "0,0,0,0", "q": "p"}
        cases = [b'{"error":{"message":"No data"}}', b"bad JSON", b"[]",
                 observation("different"), observation("9449880", metadata={"id": "9449880"}),
                 observation("9449880", metadata={"id": "9449880", "name": "Gauge", "lat": "NaN", "lon": "-123"}),
                 observation("9449880", data=[]), observation("9449880", data="bad"),
                 observation("9449880", data=[{"t": "2026-10-13 00:07"}]),
                 observation("9449880", data=[dict(row, t="2026-10-13 00:07")]),
                 observation("9449880", data=[dict(row, t="2026-10-13 00:12")]),
                 observation("9449880", data=[dict(row, t="bad")]),
                 observation("9449880", data=[row, row])]
        for body in cases:
            with self.subTest(body=body):
                store = self.root / str(len(list(self.root.iterdir())))
                with patch.object(capture, "open_url", return_value=Response(body)), \
                        patch.object(capture, "utc_now", return_value="2026-10-13T00:11:12Z"):
                    summary = collect.collect_tick(store)
                self.assertEqual(summary["state"], "collection_failed")
                self.assertEqual(summary["exitCode"], 1)
                item = json.loads((store / summary["observations"][0]["manifest"]).read_text())
                self.assertEqual(item["state"], "invalid_observations")
                self.assertIsNotNone(item["error"])
                self.assertEqual((store / "observations" / "bodies" / (item["record"]["sha256"] + ".bin")).read_bytes(), body)

    def test_observation_revisions_retain_flags_and_gaps_without_selection(self):
        import collect
        bodies = []
        revision = False

        def transport(url, timeout):
            station = parse_qs(urlparse(url).query).get("station")
            if not station:
                return Response(forecast(url))
            document = json.loads(observation(station[0]))
            document["data"][0].update(v="-1.23456" if revision else "1.23", f="1,1,1,1", q="p")
            document["data"][1]["t"] = "2026-10-13 00:12"
            raw = json.dumps(document).encode()
            bodies.append(raw)
            return Response(raw)

        with patch.object(capture, "open_url", side_effect=transport), \
                patch.object(capture, "utc_now", return_value="2026-10-13T00:13:12Z"):
            first = collect.collect_tick(self.root)
            revision = True
            second = collect.collect_tick(self.root)
        self.assertEqual(first["state"], "complete")
        self.assertEqual(second["state"], "complete")
        observed = [(self.root / "observations" / "bodies" / path.name).read_bytes()
                    for path in (self.root / "observations" / "bodies").glob("*.bin")]
        self.assertCountEqual(observed, bodies)
        self.assertEqual(len(observed), 6)
        for tick in (first, second):
            item = json.loads((self.root / tick["observations"][0]["manifest"]).read_text())
            self.assertEqual(item["rowCount"], 2)
            self.assertEqual(item["missingRowsBetweenSamples"], 1)

    def test_partial_observations_and_transport_failures_do_not_stop_later_requests(self):
        responses = iter([Response(b"partial", length=100), URLError("offline"),
                          Response(observation("9447130"))] + [Response(b"invalid archive") for _ in range(6)])
        summary, requests = self.tick(responses=responses)
        self.assertEqual(len(requests), 9)
        self.assertEqual([item["state"] for item in summary["observations"]], ["partial", "request_error", "complete"])
        self.assertEqual(summary["state"], "collection_failed")
        self.assertEqual(summary["forecasts"][0]["contractStatus"], "unsupported")

    def test_latest_unpublished_is_expected_but_older_cycle_missing_is_failure(self):
        import collect

        def transport(url, timeout):
            station = parse_qs(urlparse(url).query).get("station")
            if station:
                return Response(observation(station[0]))
            if "/etss.t00z." in url:
                raise HTTPError(url, 404, "not published", {}, io.BytesIO(b"not yet"))
            return Response(forecast(url))

        with patch.object(capture, "open_url", side_effect=transport), \
                patch.object(capture, "utc_now", return_value="2026-10-13T00:11:12Z"):
            summary = collect.collect_tick(self.root)
        self.assertEqual(summary["state"], "complete_with_unpublished")
        self.assertEqual(summary["exitCode"], 0)
        self.assertEqual(summary["forecasts"][0]["state"], "expected_unpublished")
        missing = iter([Response(observation(s)) for s in ("9449880", "9444900", "9447130")] +
                       [HTTPError("https://nomads.ncep.noaa.gov/", 404, "missing", {}, io.BytesIO(b"missing")) for _ in range(6)])
        summary, _ = self.tick(responses=missing)
        self.assertEqual(summary["state"], "collection_failed")
        self.assertEqual(summary["forecasts"][1]["state"], "collection_failed")

    def test_forecast_contract_disagreement_is_saved_without_acquisition_failure(self):
        import collect

        def transport(url, timeout):
            station = parse_qs(urlparse(url).query).get("station")
            return Response(observation(station[0]) if station else forecast(url, disagreement=True))

        with patch.object(capture, "open_url", side_effect=transport), \
                patch.object(capture, "utc_now", return_value="2026-10-13T00:11:12Z"):
            summary = collect.collect_tick(self.root)
        self.assertEqual(summary["state"], "complete")
        self.assertEqual(summary["exitCode"], 0)
        for item in summary["forecasts"]:
            self.assertEqual(item["contractStatus"], "disagreement")
            report = json.loads((self.root / item["contractReport"]).read_text())
            self.assertFalse(report["scoringPermitted"])
            self.assertFalse(report["adapterAccepted"])

    def test_nonblocking_lock_skips_requests_and_releases_after_interruption(self):
        import collect
        lock = self.root / ".collection.lock"
        with lock.open("a") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            summary, requests = self.tick()
            self.assertEqual(summary["state"], "skipped_overlap")
            self.assertEqual(requests, [])
            self.assertTrue((self.root / summary["manifest"]).exists())
        responses = iter([Response(observation("9449880")), KeyboardInterrupt()])
        with self.assertRaises(KeyboardInterrupt):
            self.tick(responses=responses)
        completed = [json.loads(p.read_text()) for p in (self.root / "ticks").glob("*.json") if not p.name.endswith("-start.json")]
        interrupted = next(item for item in completed if item["state"] == "interrupted")
        self.assertEqual(len(interrupted["observations"]), 1)
        self.assertEqual(len(list((self.root / "observations" / "records").glob("*-start.json"))), 2)
        summary, requests = self.tick(at="2026-10-13T03:00:00Z")
        self.assertEqual(len(requests), 9)
        self.assertEqual(summary["acquisitionGap"]["elapsedSeconds"], 10128)

    def test_invalid_limits_do_not_write_or_request(self):
        for kwargs in ({"max_bytes": 0}, {"timeout": 0}, {"timeout": 301}):
            with self.assertRaises(ValueError):
                self.tick(**kwargs)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_emits_json_with_exit_status_and_actual_clock(self):
        import collect
        output = io.StringIO()
        with patch.object(sys, "argv", ["collect.py", "--output", str(self.root)]), \
                patch.object(capture, "open_url", side_effect=URLError("offline")), \
                patch.object(capture, "utc_now", return_value="2026-10-13T00:11:12Z"), \
                contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as caught:
            runpy.run_path(str(Path(collect.__file__)), run_name="__main__")
        self.assertEqual(caught.exception.code, 1)
        self.assertEqual(json.loads(output.getvalue())["state"], "collection_failed")


if __name__ == "__main__":
    unittest.main()
