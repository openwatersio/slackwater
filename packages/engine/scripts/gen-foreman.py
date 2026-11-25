"""Write src/node-corrections/foreman.json from UTide's copy of Foreman's tables,
and UTide's own f and u in fixtures/foreman-utide.json, which the TypeScript,
Swift and Kotlin engines are each checked against.

    pip install utide==0.4.0
    python3 packages/engine/scripts/gen-foreman.py
    npx prettier --ignore-path /dev/null --write packages/engine/src/node-corrections/foreman.json \
      fixtures/foreman-utide.json
    npm run build --workspace @slackwater/engine
    node fixtures/generate/gen-catalog.mjs && node fixtures/generate/gen-golden.mjs

UTide's ut_constants holds t_tide's tables, which come from Foreman (1977,
revised 2004), "Manual for tidal heights analysis and prediction", IOS Pacific
Marine Science Report 77-10. Constituents are matched to the catalog by name, or
by the overrides below where t_tide's name is another line in the catalog, and
checked by speed and, for main lines, by Doodson numbers. UTide's MIT notice for the tables is in the package's LICENSE.
The catalog's M1 is the line t_tide calls NO1; foreman.ts gives it NO1's satellites.
"""

import datetime
import json
import re
import math
import pathlib

import numpy as np
from utide._ut_constants import ut_constants
from utide.harmonics import FUV

engine = pathlib.Path(__file__).resolve().parent.parent
catalog = json.loads((engine / "src/constituents/data.json").read_text())
names = {}
for c in catalog:
    for n in [c["name"], *c["aliases"]]:
        names.setdefault(n.upper(), c)
# t_tide's names for lines the catalog spells out.
# t_tide's SA and S1 carry the perihelion, as the catalog's SA_KV and S1_KV do; its Sa and S1 don't.
# Its H2 and OQ2 are the lines Kartverket names M(KS)2 and OQ2_KV; the catalog's OQ2 is another line.
for foreman, ours in {"SIG1": "sigma1", "THE1": "theta1", "GAM2": "gamma2", "H1": "alpha2", "LDA2": "lambda2", "SA": "SA_KV", "S1": "S1_KV", "H2": "M(KS)2", "OQ2": "OQ2_KV"}.items():
    names[foreman] = next(c for c in catalog if c["name"] == ours)

const, sat, shallow = ut_constants.const, ut_constants.sat, ut_constants.shallow

def catalog_entry(i):
    c = names.get(const.name[i])
    # t_tide's speeds come from its own astronomy, so they agree to about 1e-7 °/h.
    if c is None or abs(c["speed"] - const.freq[i] * 360) > 1e-5:
        return None
    # A main line's Doodson numbers must match too: S1 and S1_KV are only 2e-6 °/h apart.
    # Both count N′ = −N.
    doodson = const.doodson[i]
    if not np.isnan(doodson).any():
        # A members-only compound has no coefficients of its own, so it can't be a main line.
        if (c["coefficients"] or [])[:6] != [int(x) for x in doodson]:
            raise SystemExit(f"{const.name[i]} matched {c['name']}, whose coefficients differ")
    return c


satellites, products, unmatched, taken = {}, {}, [], {}
for i, name in enumerate(const.name):
    c = catalog_entry(i)
    if name == "Z0":
        continue
    # Two t_tide lines on one catalog name would leave only the second's table.
    if c is not None:
        if c["name"] in taken:
            raise SystemExit(f"{name} and {taken[c['name']]} both matched {c['name']}")
        taken[c["name"]] = name
    if math.isnan(const.isat[i]) and math.isnan(const.ishallow[i]):
        # t_tide gives these f = 1 and u = 0, so the catalog's members mustn't correct them.
        if c is None:
            unmatched.append(name)
        else:
            satellites[c["name"]] = []
    elif not math.isnan(const.isat[i]):
        rows = sat.iconst - 1 == i
        if c is None:
            unmatched.append(name)
            continue
        # t_tide's N' is −N; phases stay in cycles, as in its tables.
        satellites[c["name"]] = [
            [int(p), int(-n), int(pp), round(float(ph), 6), float(r), int(lat)]
            for (p, n, pp), ph, r, lat in zip(
                sat.deldood[rows], sat.phcorr[rows], sat.amprat[rows], sat.ilatfac[rows]
            )
        ]
    elif not math.isnan(const.ishallow[i]):
        start, count = int(const.ishallow[i]) - 1, int(const.nshallow[i])
        members = [
            (catalog_entry(int(shallow.iname[k]) - 1), float(shallow.coef[k]))
            for k in range(start, start + count)
        ]
        if c is None or any(m is None for m, _ in members):
            unmatched.append(name)
            continue
        products[c["name"]] = [[m["name"], f] for m, f in members]

# t_tide's ST lines are unnamed shallow-water lines the catalog doesn't hold.
expected = set()
left_out = {n for n in unmatched if not re.fullmatch(r"ST\d+", n)}
if left_out != expected:
    raise SystemExit(f"unexpected lines left out: {sorted(left_out ^ expected)}")
if any(m not in satellites for members in products.values() for m, _ in members):
    raise SystemExit("a shallow-water product names a line without its own entry")
# foreman.ts evaluates products without a perigee count, which only NO1 reads.
if any(m == "NO1" for members in products.values() for m, _ in members):
    raise SystemExit("a shallow-water product names NO1, whose correction needs a perigee count")

out = {
    "source": "UTide 0.4.0 ut_constants (t_tide; Foreman 1977, revised 2004)",
    "satellites": satellites,
    "products": products,
}

# UTide's f and u for a sample of lines, times and latitudes, the equator's clamp included, and its
# equilibrium argument V in degrees, which the engine's arguments are compared with.
picked = [i for i in range(len(const.name)) if (c := catalog_entry(i)) and (c["name"] in satellites or c["name"] in products)]
reference = []
for when in ["1995-03-10T06:00", "2006-06-21T00:00", "2024-12-31T18:00"]:
    t = datetime.datetime.fromisoformat(when)
    # UTide counts days from the proleptic Gregorian calendar's day 1, as date.toordinal does.
    day = t.toordinal() + t.hour / 24
    for latitude in [-33.9, -2.0, 2.0, 37.8, 70.66]:
        F, U, V = FUV(np.array([day]), day, np.array(picked), latitude, np.zeros(4, bool))
        reference.append({
            "time": when + ":00Z",
            "latitude": latitude,
            "values": {catalog_entry(i)["name"]: [round(float(F[0, k]), 9), round(float(U[0, k]) * 360, 7)] for k, i in enumerate(picked)},
            "arguments": {catalog_entry(i)["name"]: round(float(V[0, k]) * 360 % 360, 7) for k, i in enumerate(picked)},
        })
# Both files are written only once both are computed, so neither runs ahead of the other.
(engine / "src/node-corrections/foreman.json").write_text(json.dumps(out) + "\n")
(engine.parent.parent / "fixtures/foreman-utide.json").write_text(json.dumps(reference) + "\n")
