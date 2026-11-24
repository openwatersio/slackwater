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
Marine Science Report 77-10. Constituents are matched to the catalog by name and
checked by speed.
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

# The tables are copied from UTide, so its notice travels with them, as in the package's LICENSE.
UTIDE_LICENSE = (
    "The MIT License (MIT). Copyright (c) 2014 Wesley Bowman. Permission is hereby granted, free of charge, "
    "to any person obtaining a copy of this software and associated documentation files (the \"Software\"), "
    "to deal in the Software without restriction, including without limitation the rights to use, copy, modify, "
    "merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom "
    "the Software is furnished to do so, subject to the following conditions: The above copyright notice and "
    "this permission notice shall be included in all copies or substantial portions of the Software. "
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT "
    "LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO "
    "EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER "
    "IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR "
    "THE USE OR OTHER DEALINGS IN THE SOFTWARE."
)


def catalog_entry(i):
    c = names.get(const.name[i])
    # t_tide's speeds come from its own astronomy, so they agree to about 1e-7 °/h.
    if c is None or abs(c["speed"] - const.freq[i] * 360) > 1e-5:
        return None
    # A main line's Doodson numbers must match too: S1 and S1_KV are only 2e-6 °/h apart.
    # Both count N′ = −N.
    doodson = const.doodson[i]
    if not np.isnan(doodson).any():
        if c["coefficients"][:6] != [int(x) for x in doodson]:
            raise SystemExit(f"{const.name[i]} matched {c['name']}, whose coefficients differ")
    return c


satellites, products, unmatched = {}, {}, []
for i, name in enumerate(const.name):
    c = catalog_entry(i)
    if name == "Z0":
        continue
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

# The catalog's M1 is the 14.4966939 °/h line t_tide calls NO1.
satellites["M1"] = satellites["NO1"]

# t_tide's ST lines are unnamed shallow-water lines the catalog doesn't hold.
expected = set()
left_out = {n for n in unmatched if not re.fullmatch(r"ST\d+", n)}
if left_out != expected:
    raise SystemExit(f"unexpected lines left out: {sorted(left_out ^ expected)}")
if any(m not in satellites for members in products.values() for m, _ in members):
    raise SystemExit("a shallow-water product names a line without its own entry")

out = {
    "source": "UTide 0.4.0 ut_constants (t_tide; Foreman 1977, revised 2004)",
    "license": UTIDE_LICENSE,
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
