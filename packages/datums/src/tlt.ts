import type { HarmonicConstituent } from "@slackwater/engine";

type Find = (name: string) => HarmonicConstituent | undefined;

/**
 * Node factors f fixed by tide type, from GB 12327-2022 Appendix J, Table J.1. Sa, Ssa and
 * every constituent not listed take f = 1.
 */
const NODE_FACTORS = {
  semidiurnal: {
    Q1: 0.807,
    O1: 0.806,
    P1: 1,
    K1: 0.882,
    N2: 1.038,
    M2: 1.038,
    S2: 1,
    K2: 0.748,
    M4: 1.077,
    MS4: 1.038,
    M6: 1.118,
  },
  diurnal: {
    Q1: 1.183,
    O1: 1.183,
    P1: 1,
    K1: 1.113,
    N2: 0.963,
    M2: 0.963,
    S2: 1,
    K2: 1.317,
    M4: 0.928,
    MS4: 0.963,
    M6: 0.894,
  },
} as const;

type TideType = keyof typeof NODE_FACTORS;

/** The constituents formula J.1 uses; it ignores every other one. */
export const TLT_CONSTITUENTS = [
  "M2",
  "S2",
  "N2",
  "K2",
  "K1",
  "O1",
  "P1",
  "Q1",
  "M4",
  "MS4",
  "M6",
  "Sa",
  "Ssa",
] as const;

/** Step of the K1 phase sweep, in degrees; the standard rounds L to the centimetre. */
const PHASE_STEP = 0.1;

/**
 * The tide types whose node factors apply, by the form ratio F = (H_K1 + H_O1) / H_M2: F ≤ 0.5
 * semidiurnal, F > 4 diurnal, and mixed in between. GB 12327-2022 names the types but not
 * these bounds, which are the usual Chinese classification. A mixed tide uses both, and so
 * does a tide with none of M2, K1 and O1, whose type the ratio can't tell.
 */
export function tideTypes(find: Find): TideType[] {
  const h = (name: string) => find(name)?.amplitude ?? 0;
  if (h("M2") === 0 && h("K1") + h("O1") === 0) return ["semidiurnal", "diurnal"];
  const form = (h("K1") + h("O1")) / h("M2");
  if (form <= 0.5) return ["semidiurnal"];
  if (form > 4) return ["diurnal"];
  return ["semidiurnal", "diurnal"];
}

/**
 * China's Theoretical Lowest Tide by Vladimirsky's method, GB 12327-2022 Appendix J formula
 * J.1: the lowest level the 13 constituents can reach over every K1 phase, with fixed node
 * factors. Returns its height relative to MSL (negative below), the lower of the two results
 * for a mixed tide (the standard takes the larger depth L), or undefined when none of the
 * constituents is given.
 */
export function theoreticalLowestTide(find: Find): number | undefined {
  if (!TLT_CONSTITUENTS.some((name) => find(name))) return undefined;
  return Math.min(...tideTypes(find).map((type) => -depth(find, NODE_FACTORS[type])));
}

/** L, the depth of the datum below MSL, for one set of node factors. */
function depth(find: Find, factors: Readonly<Record<string, number>>): number {
  const rad = Math.PI / 180;
  // fH and g, with an absent constituent contributing nothing.
  const fh = (name: string) => (factors[name] ?? 1) * (find(name)?.amplitude ?? 0);
  const g = (name: string) => find(name)?.phase ?? 0;

  const a1 = g("K1") + g("O1") - g("M2");
  const a2 = g("K1") + g("P1") - g("S2");
  const a3 = g("K1") + g("Q1") - g("N2");
  const a4 = 2 * g("K1") - 180 - g("K2");
  // A semidiurnal wave and its diurnal partner add as vectors; R is the resultant's length.
  const resultant = (semi: string, di: string, phase: number) =>
    Math.sqrt(fh(semi) ** 2 + fh(di) ** 2 + 2 * fh(semi) * fh(di) * Math.cos(phase * rad));
  // The standard writes ε = tan⁻¹(y / x); atan2 keeps the resultant's quadrant when x < 0.
  const angle = (semi: string, di: string, phase: number) =>
    Math.atan2(fh(di) * Math.sin(phase * rad), fh(semi) + fh(di) * Math.cos(phase * rad)) / rad;

  let lowest = Infinity;
  for (let step = 0; step < 360 / PHASE_STEP; step++) {
    const k1 = step * PHASE_STEP;
    const e1 = angle("M2", "O1", k1 + a1);
    const e2 = angle("S2", "P1", k1 + a2);
    const m4 = 2 * e1 + 2 * g("M2") - g("M4");
    const ms4 = e1 + e2 + g("M2") + g("S2") - g("MS4");
    const m6 = 3 * e1 + 180 + 3 * g("M2") - g("M6");
    const sa = k1 - e2 / 2 + g("K1") - g("S2") / 2 - g("Sa") - 180;
    const ssa = 2 * k1 - e2 + 2 * g("K1") - g("S2") - g("Ssa");
    const level =
      fh("K1") * Math.cos(k1 * rad) +
      fh("K2") * Math.cos((2 * k1 + a4) * rad) -
      resultant("M2", "O1", k1 + a1) -
      resultant("S2", "P1", k1 + a2) -
      resultant("N2", "Q1", k1 + a3) +
      fh("M4") * Math.cos(m4 * rad) +
      fh("MS4") * Math.cos(ms4 * rad) +
      fh("M6") * Math.cos(m6 * rad) -
      fh("Sa") * Math.abs(Math.cos(sa * rad)) +
      fh("Ssa") * Math.cos(ssa * rad);
    if (level < lowest) lowest = level;
  }
  return -lowest;
}
