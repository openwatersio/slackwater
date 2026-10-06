# Astronomy and nodal corrections

A harmonic prediction sums constituents of the form `f · H · cos(V0 + ω·t + u − G)`. `H` and `G` come from the station. `V0` (the equilibrium argument), `ω` (the speed), `f` (the nodal amplitude factor) and `u` (the nodal phase correction) come from the engine. This note covers where the engine gets those, what was checked, and where the known gaps are.

The TypeScript code is in `src/astronomy`, `src/constituents` and `src/node-corrections`. The Swift port mirrors it in `Astronomy.swift`, `Constituent.swift` and `NodeCorrections.swift`, with the constituent table generated into `Resources/catalog.json`.

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

Each constituent in `data.json` carries an IHO extended Doodson number (`xdo`). `xdoToCoefficients` turns it into coefficients on `[τ, s, h, p, N′, p′, 90°]` with N′ = −N, and negates the seventh digit to move from the IHO phase convention to Schureman's, which NOAA's published phases use. `V0` is the dot product of those coefficients with the arguments at the prediction's start time.

The phase constants were spot-checked against Schureman's Table 2. That covered K1 (T + h − 90°), O1 (T − 2s + h + 90°), P1, Q1, 2Q1, J1, OO1, L2 (2T − s + 2h − p + 180°), M3, MK3, T2 and R2, and all of them match.

Prediction evaluates `V0` once at the start and advances it at the tabulated `speed`. Fitting evaluates `V` at every sample. The two agree as long as each tabulated speed matches its Doodson number. The speeds come from the IHO table, and they match the Doodson rates to within 8e-6 °/h; the worst case is M(KS)2, which drifts 0.07° a year.

A constituent with no `xdo` gets `V0` from its compound members. If the members' speeds don't add up to the tabulated speed, `V0` and `ω` describe different frequencies, and the constituent's phase then depends on when the prediction starts. [#361](https://github.com/openwatersio/slackwater/issues/361) lists the constituents where this happens.

## Nodal corrections

The engine has two correction sets, selected with `nodeCorrections`.

The IHO set (`iho.ts`) is the default, and it is the only set in the Swift port. It uses the Fourier series in Annex A of the IHO TWCWG constituent list ([local copy](../../../docs/TWCWG_Constituent_list.md)). Every coefficient in `iho.ts` was checked against the published PDF. The fundamentals with their own formulas are Mm, Mf, O1, K1, J1, M1, M1A, M1B, M1C, M2, K2, M3, L2, gamma2, alpha2, delta2, xi2 and eta2. Annex A gives Mm `u = 0` and no sine term, and the engine follows that.

The Schureman set (`schureman.ts`) uses the exact formulas from Schureman's _Manual of Harmonic Analysis and Prediction of Tides_ (Special Publication 98, 1958 reprint of the 1940 revision, [PDF](https://tidesandcurrents.noaa.gov/publications/SpecialPubNo98.pdf)). Each function cites its equation numbers. It covers Mm, Mf, O1, K1, J1, OO1, M2, K2, L2, M1 and M3. The README notes how far the two sets differ for J1 and Mf. Keep the set consistent between fitting and prediction; `fit` uses IHO.

All other constituents take their corrections from members, using the IHO letter code in `data.json`:

| Code                    | Meaning in the IHO list                              | Engine                                  |
| ----------------------- | ---------------------------------------------------- | --------------------------------------- |
| `z`                     | f = 1, u = 0                                         | unity                                   |
| `f`                     | same as M2, though unity causes no significant error | unity                                   |
| `y`                     | its own Annex A formula                              | looked up by name in the correction set |
| `a`, `m`, `o`, `k`, `j` | same as Mm, M2, O1, K1, J1                           | that member                             |
| `b`                     | u = −u(M2), f = f(M2)                                | M2 with factor −1                       |
| `c`                     | u = −2u(M2), f = f(M2)²                              | M2 with factor −2                       |
| `g`                     | u = −S·1.07 sin N, f = (√f(M2))^S for species S      | M2 with factor S/2                      |
| `p`, `d`, `q`           | same as 2MN2, KQ1 (K2 − Q1), NKM2                    | that compound's members                 |
| `x`                     | derived from the compound name (Annex B)             | `decomposeCompound`                     |

A compound's `u` is the factor-weighted sum of its members' `u`. Its `f` is the product of its members' `f` raised to the absolute value of each factor, which matches Annex B's rule that f always combines by multiplication.

### M1

M1 combines two lines either side of half of M2's speed, and Schureman gives two equivalent ways to write it (equations 188 to 205). Equation 194 puts p in the argument, `T − s + h + p − 90°`, and uses `u = −ν − Qa`, where `tan Qa = sin 2P / (3 cos I / cos²½I + cos 2P)` (196). Equation 201 leaves p out of the argument, `T − s + h − 90°`, and uses `u = ξ − ν + Q`, where `tan Q = (5 cos I − 1)/(7 cos I + 1) · tan P` (202). In that second form Q has to stay in P's quadrant, so it advances about 41° a year. Both forms use the amplitude factor `f(M1) = f(O1) / Qa` (206, 207), with `1/Qa = [1/4 + 3/2 (cos I / cos²½I) cos 2P + 9/4 (cos² I / cos⁴ ½I)]^½` (195). At mean I that comes to about `(2.310 + 1.435 cos 2P)^½` (197).

`data.json` gives M1 the equation 194 argument (`1 556 556`). The Annex A M1 formula and Schureman's `uM1` both behave like the second form, so p is counted twice. [#361](https://github.com/openwatersio/slackwater/issues/361) tracks this together with the exponent in `fM1`.

Schureman (§126) also notes that the M1 node factors in general use leave out a factor of √2.307 from Darwin's derivation. They are about 50% larger than intended, and amplitudes reduced with them are correspondingly smaller. Predictions are unaffected because the two cancel, but only when analysis and prediction use the same M1 factor.

## Compound constituents

`compound.ts` implements IHO Annex B:

1. Parse the name into letters with multipliers, distributing a parenthesised multiplier over the group.
2. Map each letter to its species: M, S, N, T, R, L, ν and λ are semidiurnal; O, P, Q and J are diurnal; K is tried as K2 first and then K1.
3. Flip signs from right to left until the species add up to the trailing number.

MA and MB annual variants decompose as their base M constituent, as Annex B says. Long-period names that don't fit the pattern, such as MSm and KOo, list explicit `members` in `data.json`.

This algorithm can't express everything the IHO table names. Some names it can't parse, some decompose into members whose speeds don't match the table, and some need S1, P1 or M1 rather than the semidiurnal letter. [#361](https://github.com/openwatersio/slackwater/issues/361) lists them. The members only supply nodal corrections, except for constituents with no `xdo`, where they also supply `V0`.

The IHO table sets each compound's phase digit directly, and for some compounds it differs from the sum of the members' digits by 90° or 180°. That only matters for station phases produced by software that sums member arguments ([#362](https://github.com/openwatersio/slackwater/issues/362)).

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

**Member speeds.** A compound's members should reproduce its speed: the sum of `factor × member.speed` should equal `speed`. Check constituents with code `x` and those that list `members` in `data.json`, including every compound with no `xdo`, whose members also supply `V0`. Skip the other letter codes, whose members only lend a nodal correction (N2 lists M2 but runs at its own speed). A few `x` and listed members are chosen for their correction the same way: the MA and MB variants borrow M2's, as Annex B says, 3N2 and 3L2 borrow N2's and L2's, and T3 borrows T2's. Any other mismatch means the nodal correction comes from the wrong lines, and for a compound with no `xdo` it also means `V0` and `ω` describe different frequencies. A constituent whose code isn't `z`, `f` or `y` but has no members gets no nodal correction at all.

**Against the sources.** Compare `iho.ts` coefficient by coefficient with Annex A in the [PDF](../../../docs/TWCWG_Constituent_list.pdf). Text extracted from the PDF drops the radicals in M3 and code `g`; the `.md` transcription keeps them. Compare `schureman.ts` with the equations its comments cite. Where Schureman gives a mean-I approximation, such as equation 197, evaluating the exact formula at mean I (about 23.45°) should reproduce his coefficients.

**IHO against Schureman.** Evaluate both sets for each fundamental over a full nodal cycle (18.61 years) and a perigee cycle (8.85 years). They differ by a few percent by design. A difference that jumps by 180°, or one that grows steadily, means a quadrant error or a double-counted argument.

**Against observations.** For constituents whose definition or phase convention is in doubt, score the published constants against raw water levels as described in [Constituent names](constituent-names.md).
