"""Fixed point comparators for protocol v1.1; no fitted forecast tuning."""

import math

from reader import require


HORIZONS = (3, 6, 12, 24)
PERIODS = (23.93447, 25.81934, 12.42060, 12.0)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def basis(t):
    return [1.0, *[f(2 * math.pi * t / p) for p in PERIODS for f in (math.sin, math.cos)]]


def anchor(values):
    if (len(values) != 96 or sum(finite(v) for v in values) < 87 or
            not all(finite(v) for v in values[-6:])):
        return None
    design = [basis(t) for t in range(-95, 1)]
    valid = [i for i, v in enumerate(values) if finite(v)]
    columns = [[design[i][j] for i in valid] for j in range(9)]
    q, r = [], [[0.0] * 9 for _ in range(9)]
    # Reorthogonalization avoids normal equations for the close tidal frequencies.
    for j, column in enumerate(columns):
        v = column[:]
        for _ in range(2):
            for i, earlier in enumerate(q):
                projection = math.fsum(a * b for a, b in zip(earlier, v))
                r[i][j] += projection
                v = [a - projection * b for a, b in zip(v, earlier)]
        r[j][j] = math.sqrt(math.fsum(a * a for a in v))
        require(r[j][j] > 1e-10, "singular detiding design")
        q.append([a / r[j][j] for a in v])
    rhs = [math.fsum(a * values[i] for a, i in zip(column, valid)) for column in q]
    coefficients = [0.0] * 9
    for j in reversed(range(9)):
        coefficients[j] = (rhs[j] - math.fsum(r[j][k] * coefficients[k] for k in range(j + 1, 9))) / r[j][j]
    return math.fsum(values[i] - math.fsum(design[i][j] * coefficients[j] for j in range(1, 9))
                     for i in range(93, 96)) / 3


def forecasts(tide, residuals, horizon, full_twl, surge):
    require(finite(tide) and horizon in HORIZONS and len(residuals) == 96, "invalid comparator inputs")
    mean = math.fsum(residuals[-24:]) / 24 if all(finite(v) for v in residuals[-24:]) else None
    latest = residuals[-1] if finite(residuals[-1]) else None
    estimate = anchor(residuals)
    change = None
    if estimate is not None and surge is not None and len(surge) == 97 and all(finite(v) for v in surge):
        # Protocol centers are C+7 (latest observation) and C+8+h (target), with 13-hour means.
        change = estimate + math.fsum(surge[2 + horizon:15 + horizon]) / 13 - math.fsum(surge[1:14]) / 13
    values = {"unchanged": (tide, None),
              "fullTwl": (full_twl, "forecast_unavailable"),
              "mean24": (tide + mean if mean is not None else None, "incomplete_last_24_hours"),
              "persistence": (tide + latest if latest is not None else None, "missing_latest_hour"),
              "surgeChange": (tide + change if change is not None else None, "anchor_or_surge_unavailable")}
    return {name: {"heightMeters": value if finite(value) else tide,
                   "fallback": not finite(value), "reason": None if finite(value) else reason}
            for name, (value, reason) in values.items()}
