"""Fixed-cohort ETSS research statistics; errors and radii are in meters."""

import math
from collections import Counter


METHODS = ("unchanged", "fullTwl", "mean24", "persistence", "surgeChange")


def quantile(values, probability):
    values = sorted(values)
    if not values:
        return None
    position = (len(values) - 1) * probability
    lower = int(position)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower)


def metrics(errors, radius):
    absolute = [abs(e) for e in errors]
    return {"count": len(errors), "mae": math.fsum(absolute) / len(errors) if errors else None,
            "rmse": math.sqrt(math.fsum(e * e for e in errors) / len(errors)) if errors else None,
            "p95": quantile(absolute, .95), "max": max(absolute, default=None), "radius": radius,
            "covered": sum(e <= radius for e in absolute) if radius is not None else None,
            "coverage": sum(e <= radius for e in absolute) / len(errors) if errors and radius is not None else None}


def errors(rows, method):
    return [r["methods"][method]["heightMeters"] - r["truth"] for r in rows]


def paired(rows, method, reference):
    own, baseline = (metrics(errors(rows, m), None) for m in (method, reference))
    return {"count": len(rows), **{k + "Difference": own[k] - baseline[k] if rows else None
                                  for k in ("mae", "rmse")}}


def sensitivity(rows, method):
    omitted = [paired([r for r in rows if r["date"] != date], method, "unchanged")
               for date in sorted({r["date"] for r in rows})]
    return {"omittedDateCount": len(omitted), **{
        k + "Range": [min(values), max(values)] if values else None
        for k in ("maeDifference", "rmseDifference")
        for values in [[v[k] for v in omitted if v[k] is not None]]}}


def cell(rows, method, radius):
    valid = [r for r in rows if r["truth"] is not None]
    rapid = [r for r in valid if r["rapid"] is True]
    corrected = [r for r in valid if not r["methods"][method]["fallback"]]
    episodes = []
    for episode in sorted({r["episode"] for r in rapid}):
        members = [r for r in rapid if r["episode"] == episode]
        episodes.append({"episode": episode, "dates": [r["date"] for r in members],
                         **metrics(errors(members, method), radius),
                         "paired": paired(members, method, "unchanged")})
    return {"scheduledCount": len(rows), "overall": metrics(errors(valid, method), radius),
            "rapid": metrics(errors(rapid, method), radius), "corrected": metrics(errors(corrected, method), radius),
            "fallbackCount": sum(r["methods"][method]["fallback"] for r in valid),
            "fallbackReasons": dict(Counter(r["methods"][method]["reason"] for r in valid if r["methods"][method]["fallback"])),
            "scheduledFallbackReasons": dict(Counter(r["methods"][method]["reason"] for r in rows if r["methods"][method]["fallback"])),
            "missingTruth": dict(Counter(r["truthReason"] for r in rows if r["truth"] is None)),
            "unknownLabels": sum(r["rapid"] is None for r in valid),
            "scheduledUnknownLabels": sum(r["rapid"] is None for r in rows),
            "rapidEpisodes": len(episodes),
            "paired": {name: paired(valid, method, name) for name in METHODS if name != method},
            "pairedRapid": paired(rapid, method, "unchanged"),
            "leaveOneDateOut": {"overall": sensitivity(valid, method), "rapid": sensitivity(rapid, method)},
            "worstEpisodes": sorted(episodes, key=lambda e: (-e["rmse"], e["episode"]))}


def shared_radius(station_rows, method):
    radii = [quantile([abs(e) for e in errors([r for r in rows if r["truth"] is not None], method)], .9)
             for rows in station_rows.values()]
    return max(radii) if radii and all(r is not None for r in radii) else None


def gate(result, horizon):
    if (result["overall"]["count"] < 20 or result["rapid"]["count"] < 5 or result["rapidEpisodes"] < 3 or
            result["overall"]["radius"] is None):
        return "inconclusive"
    overall = result["paired"].get("unchanged", {"maeDifference": 0., "rmseDifference": 0.})
    rapid = result["pairedRapid"]
    passed = (overall["maeDifference"] <= 0 and overall["rmseDifference"] <= 0 and
              rapid["maeDifference"] <= 0 and rapid["rmseDifference"] <= 0 and
              (horizon != 24 or overall["rmseDifference"] < 0) and
              result["overall"]["coverage"] >= .9 and result["rapid"]["coverage"] >= .9)
    return "pass" if passed else "fail"
