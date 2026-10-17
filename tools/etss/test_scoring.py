import math
import unittest

import scoring


def case(day, error, *, rapid=False, episode=None, fallback=False, truth=True):
    return {"date": day, "rapid": rapid, "episode": episode,
            "truth": 0.0 if truth else None, "truthReason": None if truth else "missing",
            "methods": {name: {"heightMeters": error * factor, "fallback": fallback,
                                 "reason": "unavailable" if fallback else None}
                        for name, factor in zip(scoring.METHODS, (2, 1, 1, 1, 1))}}


class ScoresTest(unittest.TestCase):
    def test_metrics_keep_outliers_and_linear_quantiles(self):
        result = scoring.metrics([-1, 2, -3, 10], 3)
        self.assertEqual(result["count"], 4)
        self.assertEqual(result["mae"], 4)
        self.assertAlmostEqual(result["rmse"], math.sqrt(28.5))
        self.assertAlmostEqual(result["p95"], 8.95)
        self.assertEqual(result["max"], 10)
        self.assertEqual(result["coverage"], .75)
        self.assertIsNone(scoring.metrics([], None)["mae"])
        self.assertEqual(scoring.quantile([4], .9), 4)

    def test_denominators_fallback_pairing_and_unknowns(self):
        rows = [case("a", 1, rapid=True, episode="e1"),
                case("b", 2, rapid=None, fallback=True),
                case("c", 9, rapid=True, episode="e1", truth=False)]
        cell = scoring.cell(rows, "fullTwl", 1)
        self.assertEqual(cell["overall"]["count"], 2)
        self.assertEqual(cell["rapid"]["count"], 1)
        self.assertEqual(cell["corrected"]["count"], 1)
        self.assertEqual(cell["fallbackCount"], 1)
        self.assertEqual(cell["missingTruth"], {"missing": 1})
        self.assertEqual(cell["unknownLabels"], 1)
        self.assertEqual(cell["paired"]["unchanged"]["maeDifference"], -1.5)
        self.assertEqual(cell["worstEpisodes"][0]["dates"], ["a"])
        self.assertEqual(cell["leaveOneDateOut"]["overall"]["rmseDifferenceRange"], [-2, -1])
        self.assertEqual(scoring.cell([], "fullTwl", None)["worstEpisodes"], [])

    def test_shared_radius_requires_every_gauge(self):
        groups = {str(i): [case("a", i), case("b", i + 1, fallback=True)] for i in (1, 2, 3)}
        self.assertAlmostEqual(scoring.shared_radius(groups, "fullTwl"), 3.9)
        groups["2"] = []
        self.assertIsNone(scoring.shared_radius(groups, "fullTwl"))

    def test_acceptance_requires_samples_point_improvement_and_coverage(self):
        rows = [case(str(i), .1, rapid=i < 6, episode=str(i // 2) if i < 6 else None) for i in range(20)]
        cell = scoring.cell(rows, "fullTwl", .2)
        self.assertEqual(scoring.gate(cell, 24), "pass")
        self.assertEqual(scoring.gate(scoring.cell(rows[:19], "fullTwl", .2), 24), "inconclusive")
        self.assertEqual(scoring.gate(scoring.cell(rows, "fullTwl", None), 24), "inconclusive")
        self.assertEqual(scoring.gate(scoring.cell(rows, "unchanged", .3), 24), "fail")
        self.assertEqual(scoring.gate(scoring.cell(rows, "fullTwl", .05), 3), "fail")


if __name__ == "__main__":
    unittest.main()
