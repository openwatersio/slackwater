"""Post-hoc Godin labels using independently frozen per-sample truth vintages."""

import math
from datetime import timedelta

import observations
from comparators import finite
from observations import utc
from reader import iso


def godin(values):
    if len(values) != 71 or not all(finite(v) for v in values):
        return None
    for width in (24, 24, 25):
        values = [math.fsum(values[i:i + width]) / width for i in range(len(values) - width + 1)]
    return values[0]


def assign_episodes(calendar):
    episode = None
    for day in calendar:
        if day["rapid"] is False:
            episode = None
        elif day["rapid"] is True and episode is None:
            episode = day["date"]
        day["episode"] = episode if day["rapid"] is True else None


def truth_grid(paths, station, begin, end, snapshot):
    selected, diagnostics = {}, []
    for path in sorted(paths):
        try:
            receipt = observations.load_receipt(path, station, snapshot)
            received = utc(receipt["receivedAt"])
            if receipt["rows"] is None:
                continue
            for at, sample in receipt["rows"]:
                deadline = at + timedelta(hours=24)
                if not (begin <= at <= end and deadline <= snapshot and received <= deadline and sample["valid"]):
                    continue
                rank = (-received.timestamp(), receipt["manifest"])
                if at not in selected or rank < selected[at][0]:
                    selected[at] = (rank, {**sample, **{k: receipt[k] for k in
                        ("manifest", "manifestSha256", "bodySha256", "receivedAt")}})
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            diagnostics.append({"manifest": path.name, "reason": str(error)})
    return {iso(at): sample for at, (_, sample) in selected.items()}, diagnostics


def rapid_labels(paths, station, decisions, tide, snapshot):
    first, last = decisions[0] - timedelta(hours=35), decisions[-1] + timedelta(hours=59)
    truth, diagnostics = truth_grid(paths, station, first, last, snapshot)
    calendar = []
    for decision in decisions:
        support = [iso(decision + timedelta(hours=h)) for h in range(-35, 60)]
        values = [float(truth[at]["heightMeters"]) - tide[at]
                  if at in truth and finite(tide.get(at)) else None for at in support]
        before, after = godin(values[:71]), godin(values[24:])
        delta = after - before if before is not None and after is not None else None
        calendar.append({"date": decision.date().isoformat(), "decisionAt": iso(decision),
                         "rapid": abs(delta) >= .10 - 1e-12 if delta is not None else None,
                         "changeMeters": delta, "supportBegin": support[0], "supportEnd": support[-1],
                         "missingSupport": [at for at, v in zip(support, values) if v is None],
                         "maturesAt": iso(decision + timedelta(hours=83))})
    assign_episodes(calendar)
    return {"calendar": calendar, "truth": truth, "rejectedReceipts": diagnostics}
