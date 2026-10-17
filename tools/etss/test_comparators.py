import importlib
import math
import unittest
from pathlib import Path


class ComparatorTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(Path(__file__).with_name("comparators.py").exists(), "fixed comparators are missing")
        self.c = importlib.import_module("comparators")

    def test_detiding_recovers_constant_without_removing_background(self):
        samples = [0.2 + 0.1 * math.sin(2 * math.pi * t / 12.42060) +
                   0.07 * math.cos(2 * math.pi * t / 23.93447) for t in range(-95, 1)]
        self.assertAlmostEqual(self.c.anchor(samples), 0.2, places=10)
        samples[:9] = [None] * 9
        self.assertAlmostEqual(self.c.anchor(samples), 0.2, places=10)
        samples[9] = None
        self.assertIsNone(self.c.anchor(samples))
        for broken in ([0.2] * 95, [0.2] * 90 + [None] + [0.2] * 5, [float("inf")] * 96):
            self.assertIsNone(self.c.anchor(broken))

    def test_mean_and_last_residual_have_distinct_support_and_no_offset_decay(self):
        residuals = [0.0] * 72 + [0.2] * 23 + [0.44]
        result = self.c.forecasts(2.0, residuals, 3, None, None)
        self.assertAlmostEqual(result["mean24"]["heightMeters"], 2.21)
        self.assertEqual(result["persistence"]["heightMeters"], 2.44)
        self.assertEqual(result["unchanged"]["heightMeters"], 2.0)
        self.assertEqual(result["fullTwl"]["heightMeters"], 2.0)
        self.assertTrue(result["fullTwl"]["fallback"])
        residuals[-2] = None
        result = self.c.forecasts(2.0, residuals, 24, None, None)
        self.assertTrue(result["mean24"]["fallback"])
        self.assertFalse(result["persistence"]["fallback"])
        residuals[-1] = None
        self.assertTrue(self.c.forecasts(2.0, residuals, 24, None, None)["persistence"]["fallback"])

    def test_full_twl_is_absolute_and_surge_change_uses_fixed_centers(self):
        for horizon, expected in ((3, 2.24), (6, 2.27), (12, 2.33), (24, 2.45)):
            surge = [0.5 + t * 0.01 for t in range(97)]
            result = self.c.forecasts(2.0, [0.2] * 96, horizon, 1.1, surge)
            self.assertEqual(result["fullTwl"]["heightMeters"], 1.1)
            self.assertFalse(result["fullTwl"]["fallback"])
            self.assertAlmostEqual(result["surgeChange"]["heightMeters"], expected, places=10)
            shifted = self.c.forecasts(2.0, [0.2] * 96, horizon, 1.1, [v + 123 for v in surge])
            self.assertAlmostEqual(shifted["surgeChange"]["heightMeters"], expected, places=10)
        for bad in (None, [0.5] * 96, [None] + [0.5] * 96, [float("nan")] * 97):
            result = self.c.forecasts(2.0, [0.2] * 96, 24, None, bad)
            self.assertTrue(result["surgeChange"]["fallback"])
            self.assertEqual(result["surgeChange"]["heightMeters"], 2.0)
        with self.assertRaises(ValueError):
            self.c.forecasts(float("nan"), [0.2] * 96, 24, None, None)
        with self.assertRaises(ValueError):
            self.c.forecasts(2.0, [0.2] * 96, 1, None, None)


if __name__ == "__main__":
    unittest.main()
