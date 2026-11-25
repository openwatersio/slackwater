# Astronomy and nodal corrections

A harmonic prediction sums constituents of the form `f · H · cos(V0 + ω·t + u − G)`. `H` and `G` come from the station. `V0` (the equilibrium argument), `ω` (the speed), `f` (the nodal amplitude factor) and `u` (the nodal phase correction) come from the engine. This note covers where the engine gets those, what was checked, and where the known gaps are.

The TypeScript code is in `src/astronomy`, `src/constituents` and `src/node-corrections`. The Swift port mirrors it in `Astronomy.swift`, `Constituent.swift`, `NodeCorrections.swift` and `Foreman.swift`, with the constituent table and Foreman's tables generated into `Resources/catalog.json`. The Kotlin port has the same files, with the tables generated into `CatalogData.kt` and `ForemanData.kt`.

## Astronomical arguments

`astro()` evaluates the mean longitudes as polynomials in Julian centuries from J2000, using the coefficients in Meeus, _Astronomical Algorithms_, 1st edition (1991):

| Symbol      | Meaning                                | Source                                           |
| ----------- | -------------------------------------- | ------------------------------------------------ |
| `s`         | Moon's mean longitude                  | Meeus lunar mean longitude                       |
| `h`         | Sun's mean longitude                   | Meeus solar mean longitude                       |
| `p`         | longitude of the lunar perigee         | Meeus                                            |
| `N`         | longitude of the Moon's ascending node | Meeus                                            |
| `pp` (p′)   | longitude of the solar perigee         | Sun's mean longitude minus its mean anomaly      |
| `omega` (ω) | obliquity of the ecliptic              | Laskar's series as given by Meeus (formula 21.3) |
| `i`         | inclination of the lunar orbit         | fixed at 5.145°, as in Schureman                 |

τ (`T+h-s`) is built from T, the hour angle of the mean sun, which comes from the fractional Julian date and is 180° at 00:00 UTC. Schureman's derived angles I, ν, ξ, ν′ and ν″ are computed from N, i and ω with his exact spherical formulas (ν′ and ν″ from equations 224 and 232).

The polynomials are evaluated in UTC rather than Terrestrial Time. ΔT is about 69 s, which moves `s` by about 0.01°, so the difference doesn't show in predictions. Speeds from `astro()` are derivatives of the same polynomials. Prediction and fitting don't use them; the speed check below does.

Small errors in these constants and a NaN at exactly J2000 are tracked in [#362](https://github.com/openwatersio/slackwater/issues/362).

## Equilibrium arguments and speeds

Each constituent in `data.json` carries Doodson coefficients on `[τ, s, h, p, N′, p′, 90°]` with N′ = −N. τ is measured from noon, as in Schureman's equilibrium arguments, which NOAA's published phases use. The coefficients give Schureman's arguments for every line except the 17 described below. An IHO extended Doodson number (XDO) converts by taking 5 from D₂ to D₆ and replacing D₇ with 5 − D₇. That shifts the argument by (D₁ + D₇ − 5) × 180°, which is a whole turn for most lines, but not for the 21 where D₁ + D₇ is even, such as S1, M3, S3 and M7. Each of those keeps the phase that matches Schureman: S1's IHO row `1 645 555` converts to Schureman's T, while M3 (`3 555 557`), S3 (`3 825 557`) and M7 (`7 555 557`) take the IHO phase unconverted, which in noon-τ coefficients is a last number of 0. The other 17 keep the converted phase until a source shows otherwise ([#241](https://github.com/openwatersio/slackwater/issues/241)). `V0` is the dot product of the coefficients with the arguments at the prediction's start time.

The phase constants were spot-checked against Schureman's Table 2. That covered K1 (T + h − 90°), O1 (T − 2s + h + 90°), P1, Q1, 2Q1, J1, OO1, L2 (2T − s + 2h − p + 180°), M3, MK3, T2 and R2, and all of them match.

Prediction evaluates `V0` once at the start and advances it at the tabulated `speed`. Fitting evaluates `V` at every sample, or in its yearly mode at each year's January 1, advanced at the tabulated `speed`. The two agree as long as each tabulated speed matches its Doodson number. The speeds come from the IHO table, and they match the Doodson rates to within 8e-6 °/h; the worst case is M(KS)2, which drifts 0.07° a year.

A constituent with null `coefficients` gets `V0` from its compound members. If the members' speeds didn't add up to the tabulated speed, `V0` and `ω` would describe different frequencies, and the constituent's phase would depend on when the prediction starts. Extremes, found from each day's own midnight, would then drift away from a timeline started months earlier. A test checks that every constituent's `V0` advances at its tabulated speed to within 1e-5 °/h.

The IHO list gives eight constituents an alphabetical XDO but no numerical one, because some of their digits fall outside 0–9: 3(SM)N2, (SK)K5, 5MSN10, 4M2SN10, 3N2MS12, MA12, 4ML12 and 5MSN12. `data.json` takes their coefficients from the alphabetical codes, read as numerical XDO digits and converted like any other. After the first letter, which is the species (A = 1), Z is 5, each letter from A onwards adds one (A = 6, E = 10), and each letter from Y backwards subtracts one (Y = 4, T = −1). For seven of them the code reproduces the tabulated speed. 3N2MS12's code (L YZA YZZ) gives N′ a coefficient of −1, but its tabulated speed of 173.362457 °/h needs +1, so `data.json` follows the speed: published constants are fitted at the tabulated speed.

## Nodal corrections

The engine has three correction sets, selected with `nodeCorrections`. The TypeScript predictors and `fit` take any of the three. The Swift and Kotlin engines predict with IHO's or Foreman's, and fit with IHO's.

The IHO set (`iho.ts`) is the default. It uses the Fourier series in Annex A of the IHO TWCWG constituent list ([local copy](../../../docs/TWCWG_Constituent_list.md)). Every coefficient in `iho.ts` was checked against the published PDF. The fundamentals with their own formulas are Mm, Mf, O1, K1, J1, M1, M1A, M1B, M1C, M2, K2, M3, L2, gamma2, alpha2, delta2, xi2 and eta2. Annex A gives Mm `u = 0` and no sine term, and the engine follows that.

The Schureman set (`schureman.ts`) uses the exact formulas from Schureman's _Manual of Harmonic Analysis and Prediction of Tides_ (Special Publication 98, 1958 reprint of the 1940 revision, [PDF](https://tidesandcurrents.noaa.gov/publications/SpecialPubNo98.pdf)). Each function cites its equation numbers. It covers Mm, Mf, O1, K1, J1, OO1, M2, K2, L2, M1 and M3. The README notes how far the two sets differ for J1 and Mf. Keep the set consistent between fitting and prediction.

The Foreman set (`foreman.ts`) is the one t_tide and UTide use, from Foreman's _Manual for Tidal Heights Analysis and Prediction_ (IOS Pacific Marine Science Report 77-10, revised 2004). Each of 37 main lines sums its satellites, and two kinds of satellite scale with the site's latitude, held at least 5° from the equator as t_tide holds it, so `foreman(latitude)` builds the set for a site. Shallow-water lines are products of main lines, by Foreman's rules. Lines t_tide gives neither keep f = 1 and u = 0, whatever their catalog members: SA_KV, Ssa, Mm, Mf, MSf, MSm and T2. Other catalog names on those lines, such as MSo, SM, Mnum, KOo and MKo, are compounds of their own, which t_tide doesn't name, so they keep their members' correction. At exactly 0° t_tide divides by zero; `foreman` takes 5° north. Catalog lines t_tide doesn't have fall back to their members, or to f = 1 and u = 0 without them, as M1A, M1B and M1C do. `foreman.json` holds the tables, generated from UTide 0.4.0's copy by `scripts/gen-foreman.py`, which matches t_tide's names to the catalog's, checks their speeds and each main line's Doodson numbers, and fails if a line other than the known ones is left out. UTide's MIT notice is in the package's [LICENSE](../LICENSE), which npm ships. UTide's own f and u at three dates and five latitudes, in `fixtures/foreman-utide.json`, check each engine's set to 1e-4 in f (5e-5 in TypeScript) and 0.01° in u; the two astronomies' polynomials leave about 1e-5 and 0.002°. `fixtures/prediction-foreman.json` holds TypeScript predictions of every line in the tables at four latitudes, the equator's clamp on both sides among them, and Swift and Kotlin match its heights to 1e-6 m. t_tide's NO1 is the catalog's M1 line, and both names take its satellites, as t_tide's H1 and H2 take those of the catalog's alpha2 and M(KS)2. t_tide's SA and S1 include the perihelion, so they are the catalog's SA_KV and S1_KV; the catalog's Sa and S1, without it, keep f = 1 and u = 0. t_tide's H2 is the catalog's M(KS)2 and its OQ2 the catalog's OQ2_KV, the names Kartverket publishes them under. The catalog's own OQ2 is a compound on another line, so it keeps its members' correction, and `fit` and the predictors refuse it with Foreman's set, as they refuse Sa and S1. t_tide's H1 and H2 aren't catalog names: `fit` doesn't know them, and the predictors refuse them with Foreman's set, naming alpha2 and M(KS)2, rather than drop them as they drop other unknown names. The catalog has no line for t_tide's unnamed shallow-water lines.

Foreman's set replaces f and u only; the arguments V stay the catalog's. `fixtures/foreman-utide.json` also holds UTide's own arguments, which a test checks against the catalog's. They agree on every line in the tables except O2 (180°, t_tide takes O2 as twice O1) and M7. t_tide's M7 is 3.5 times M2's argument wrapped to a turn, so it agrees with the catalog's at some dates and is 180° off at others; the catalog's is 3.5 times M2's unwrapped, as Schureman gives it. Constants the engine fits with Foreman's set predict back exactly, since both use the catalog's arguments. Phases t_tide or UTide published for those two lines are on t_tide's arguments, and need the difference added before the engine predicts them. Kartverket's records in `@slackwater/database` carry neither.

All other constituents take their corrections from the `members` listed in `data.json`. The IHO list gives each a letter code instead, and the members are what those codes resolve to:

| Code                    | Meaning in the IHO list                              | Members in `data.json`                |
| ----------------------- | ---------------------------------------------------- | ------------------------------------- |
| `z`                     | f = 1, u = 0                                         | none                                  |
| `f`                     | same as M2, though unity causes no significant error | none                                  |
| `y`                     | its own Annex A formula                              | none; looked up by name in the set    |
| `a`, `m`, `o`, `k`, `j` | same as Mm, M2, O1, K1, J1                           | that constituent                      |
| `b`                     | u = −u(M2), f = f(M2)                                | M2 with factor −1                     |
| `c`                     | u = −2u(M2), f = f(M2)²                              | M2 with factor −2                     |
| `g`                     | u = −S·1.07 sin N, f = (√f(M2))^S for species S      | M2 with factor S/2                    |
| `p`, `d`, `q`           | same as 2MN2, KQ1 (K2 − Q1), NKM2                    | that compound's members               |
| `x`                     | derived from the compound name (Annex B)             | the decomposition, as described below |

A compound's `u` is the factor-weighted sum of its members' `u`. Its `f` is the product of its members' `f` raised to the absolute value of each factor, which matches Annex B's rule that f always combines by multiplication.

### M1

M1 combines two lines either side of half of M2's speed, and Schureman gives two equivalent ways to write it (equations 188 to 205). Equation 194 puts p in the argument, `T − s + h + p − 90°`, and uses `u = −ν − Qa`, where `tan Qa = sin 2P / (3 cos I / cos²½I + cos 2P)` (196). Equation 201 leaves p out of the argument, `T − s + h − 90°`, and uses `u = ξ − ν + Q`, where `tan Q = (5 cos I − 1)/(7 cos I + 1) · tan P` (202). In that second form Q has to stay in P's quadrant, so it advances about 41° a year. Both forms use the amplitude factor `f(M1) = f(O1) / Qa` (206, 207), with `1/Qa = [1/4 + 3/2 (cos I / cos²½I) cos 2P + 9/4 (cos² I / cos⁴ ½I)]^½` (195). At mean I that comes to about `(2.310 + 1.435 cos 2P)^½` (197).

`data.json` gives M1 the equation 194 argument (`1 556 556`). The Annex A M1 formula and Schureman's `uM1` (equation 202) are both written for the second form's argument, the IHO list's `1 555 556`, which leaves p out. The IHO list also tags the `1 556 556` row with code `y`, pointing at the same formula, which fits that row only once p comes off. So each takes off as many turns of p as the argument it corrects holds, counted through members for an argument built from them: one for the catalog's M1, none for M1C or for a caller's definition without p. Schureman's set has no M1C formula, so there the catalog's M1C is unity. The result is wrapped to ±180°. For M1's own argument, u less p stays near zero and never wraps, so a compound with a fractional M1 member doesn't jump. M1C's u turns with p, so a fractional M1C member still jumps once a perigee cycle. IHO code `g` gives M1 inside a compound the MS-type values instead (u = −1.07 sin N, f = √f(M2)); the engine uses M1's own formula there. Q comes from `atan2(k sin P, cos P)`, which keeps it in P's quadrant. The two sets' M1 phases agree within 2.4° over a nodal cycle. The p taken off is the argument's: in `fit`'s yearly mode the argument is taken at January 1 while u is taken at July 2, so p comes from January 1. That is NOAA's M1, not the predictors', so a yearly fit of data the predictors make returns M1's phase about 20° later, p's advance over half a year. That reproduces NOAA's yearly M1, which uses equation 201's argument at the p line's speed. Foreman's M1 is written for the catalog's argument, with p, so it takes nothing off and the epoch doesn't enter: a yearly fit with Foreman's set keeps p in M1's argument, as t_tide does.

Schureman (§126) also notes that the M1 node factors in general use leave out a factor of √2.307 from Darwin's derivation. They are about 50% larger than intended, and amplitudes reduced with them are correspondingly smaller. Predictions are unaffected because the two cancel, but only when analysis and prediction use the same M1 factor.

## Compound constituents

Compound members in `data.json` follow IHO Annex B, except for NOAA's compounds at Anchorage, which follow NOAA's compositions ([constituent names](constituent-names.md#noaas-shallow-water-compounds)):

1. Parse the name into letters with multipliers, distributing a parenthesised multiplier over the group.
2. Map each letter to its species: M, S, N, T, R, L, ν and λ are semidiurnal; O, P, Q and J are diurnal; K is K2 or K1.
3. Flip signs from right to left until the species add up to the trailing number.

MA and MB annual variants take their base M constituent's members, as Annex B says. Long-period names that don't fit the pattern, such as MSm and KOo, have members chosen by hand. The engine doesn't parse names, so a constituent predicts with exactly the members its entry lists, and fixing a decomposition is an edit to that entry.

Annex B can't express everything the IHO table names. Some names it can't parse, some decompose into members whose speeds don't match the table, and some need S1, P1 or M1 rather than the semidiurnal letter. [#361](https://github.com/openwatersio/slackwater/issues/361) lists them. The members only supply nodal corrections, except for constituents with null `coefficients`, where they also supply `V0`.

The IHO table sets each compound's phase digit directly, and for some compounds it differs from the sum of the members' digits by 90° or 180°. That only matters for station phases produced by software that sums member arguments ([#362](https://github.com/openwatersio/slackwater/issues/362)). NOAA's software does, so its Anchorage compounds take the sum of their members' arguments.

## Checking changes

These checks found every issue linked above. Run them after changing `data.json`, the astronomy, or the correction formulas.

**Doodson speeds.** Each constituent's `speed` should equal its Doodson coefficients times the argument rates:

```ts
import { astro, constituents } from "@slackwater/engine";

const a = astro(new Date("2026-06-01T00:00:00Z")); // any instant except exactly J2000
const rates = [a["T+h-s"].speed, a.s.speed, a.h.speed, a.p.speed, -a.N.speed, a.pp.speed, 0];
for (const c of new Set(Object.values(constituents))) {
  if (!c.coefficients) continue;
  const derived = c.coefficients.reduce((sum, k, i) => sum + k * rates[i], 0);
  if (Math.abs(derived - c.speed) > 1e-5) console.log(c.name, c.speed, derived);
}
```

**Member speeds.** A compound's members should reproduce its speed: the sum of `factor × member.speed` should equal `speed`. Otherwise the nodal correction comes from the wrong lines, and for a compound with null `coefficients`, `V0` and `ω` also describe different frequencies. Constituents whose members only lend a nodal correction are exempt: the single-member IHO codes (N2 lists M2 but runs at its own speed), `p`, `d` and `q` entries such as OO1, the MA and MB variants, 3N2, 3L2 and T3. The "Compound members" test in `test/constituents/index.test.ts` checks every entry. It lists those exemptions, and separately the compounds whose Annex B decompositions don't add up ([#361](https://github.com/openwatersio/slackwater/issues/361)), so any new mismatch fails it. A constituent the IHO list gives a correction but `data.json` gives no members gets no nodal correction at all. The same test file lists every constituent without one: those IHO gives unity, and fifteen code `x` compounds, such as MS1, MPS2 and 2MNO6, whose names Annex B parsing couldn't decompose.

**Against the sources.** Compare `iho.ts` coefficient by coefficient with Annex A in the [PDF](../../../docs/TWCWG_Constituent_list.pdf). Text extracted from the PDF drops the radicals in M3 and code `g`; the `.md` transcription keeps them. Compare `schureman.ts` with the equations its comments cite. Where Schureman gives a mean-I approximation, such as equation 197, evaluating the exact formula at mean I (about 23.45°) should reproduce his coefficients.

**IHO against Schureman.** Evaluate both sets for each fundamental over a full nodal cycle (18.61 years) and a perigee cycle (8.85 years). They differ by a few percent by design. A difference that jumps by 180°, or one that grows steadily, means a quadrant error or a double-counted argument.

**Against observations.** For constituents whose definition or phase convention is in doubt, score the published constants against raw water levels as described in [Constituent names](constituent-names.md).
