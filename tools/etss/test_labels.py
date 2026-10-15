import unittest
import tempfile
from datetime import timedelta
from pathlib import Path

import labels
from observations import utc
from reader import iso
import test_observations
from test_observations import row


class LabelsTest(unittest.TestCase):
    def test_godin_independent_impulse_and_linear_oracles(self):
        self.assertAlmostEqual(labels.godin(list(range(71))), 35)
        impulse = [0.] * 71
        impulse[35] = 1.
        count = sum(a + b + c == 35 for a in range(24) for b in range(24) for c in range(25))
        self.assertAlmostEqual(labels.godin(impulse), count / (24 * 24 * 25))
        impulse[0] = None
        self.assertIsNone(labels.godin(impulse))
        self.assertIsNone(labels.godin([]))

    def test_episodes_unknown_days_do_not_split_and_nonrapid_does(self):
        values = [{"date": str(i), "rapid": v} for i, v in enumerate([True, None, True, False, True])]
        labels.assign_episodes(values)
        self.assertEqual([v["episode"] for v in values], ["0", None, "0", None, "4"])

    def test_truth_vintage_ties_later_invalid_and_immature_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = test_observations.ObservationTests()
            helper.root = Path(tmp)
            paths = [helper.receipt("b", at="2026-10-15T01:00:00Z", rows=[row(v="2")]),
                     helper.receipt("a", at="2026-10-15T01:00:00Z", rows=[row(v="3")]),
                     helper.receipt("late", at="2026-10-15T01:00:00.000001Z", rows=[row(v="9")]),
                     helper.receipt("invalid", rows=[row(f="1,1,0,0")])]
            at = utc("2026-10-14T01:00:00Z")
            early, _ = labels.truth_grid(paths, "9447130", at, at, at + timedelta(hours=23))
            self.assertEqual(early, {})
            result, rejected = labels.truth_grid(paths, "9447130", at, at, at + timedelta(hours=25))
            self.assertEqual(result[iso(at)]["heightMeters"], "3")
            self.assertEqual(rejected, [])
            paths[0].write_text("bad")
            _, rejected = labels.truth_grid(paths, "9447130", at, at, at + timedelta(hours=25))
            self.assertEqual(len(rejected), 1)

    def test_rapid_label_uses_all_95_residual_hours_and_keeps_support(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = test_observations.ObservationTests()
            helper.root = Path(tmp)
            decision = utc("2026-10-12T02:00:00Z")
            tide, paths = {}, []
            for h in range(-35, 60):
                at = decision + timedelta(hours=h)
                tide[iso(at)] = 1.
                paths.append(helper.receipt(str(h), at=iso(at + timedelta(hours=1)),
                    rows=[row(at.strftime("%Y-%m-%d %H:%M"), v=str(1 + .01 * h))]))
            result = labels.rapid_labels(paths, "9447130", [decision], tide, decision + timedelta(hours=83))
            day = result["calendar"][0]
            self.assertTrue(day["rapid"])
            self.assertAlmostEqual(day["changeMeters"], .24)
            self.assertEqual(day["missingSupport"], [])
            early = labels.rapid_labels(paths, "9447130", [decision], tide, decision + timedelta(hours=82))
            self.assertIsNone(early["calendar"][0]["rapid"])
            self.assertEqual(len(early["calendar"][0]["missingSupport"]), 1)


if __name__ == "__main__":
    unittest.main()
