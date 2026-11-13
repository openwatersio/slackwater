import { constituentModels } from "./constituents/index.js";
import {
  checkWeights,
  fit,
  type FitOptions,
  type HarmonicFit,
  type HarmonicSample,
} from "./fit.js";

export interface Candidate {
  name: string;
  /**
   * The constituent the Rayleigh criterion compares this one with. Without
   * one, it is compared with every candidate kept before it.
   */
  comparison?: string;
}

/**
 * Foreman's standard 45 astronomical and 24 shallow-water constituents, each
 * with its Rayleigh comparison constituent (Foreman 1977, Appendix 1), under
 * the catalog's names. Z0 is the fit's offset, so only stands as a comparison
 * here. Foreman's OQ2 is left out, since the catalog's OQ2 is the O1 + Q1
 * compound on another line. The catalog has no H1 or H2, so selection reports
 * them as unknown unless `definitions` adds them.
 */
export const foremanCandidates: readonly Candidate[] = [
  ["Sa", "Ssa"],
  ["Ssa", "Z0"],
  ["MSm", "Mm"],
  ["Mm", "MSf"],
  ["MSf", "Z0"],
  ["Mf", "MSf"],
  ["ALP1", "2Q1"],
  ["2Q1", "Q1"],
  ["sigma1", "2Q1"],
  ["Q1", "O1"],
  ["rho1", "Q1"],
  ["O1", "K1"],
  ["tau1", "O1"],
  ["BET1", "NO1"],
  ["NO1", "K1"],
  ["chi1", "NO1"],
  ["pi1", "P1"],
  ["P1", "K1"],
  ["S1", "K1"],
  ["K1", "Z0"],
  ["psi1", "K1"],
  ["phi1", "K1"],
  ["theta1", "J1"],
  ["J1", "K1"],
  ["SO1", "OO1"],
  ["OO1", "J1"],
  ["ups1", "OO1"],
  ["eps2", "2N2"],
  ["2N2", "mu2"],
  ["mu2", "N2"],
  ["N2", "M2"],
  ["nu2", "N2"],
  ["gamma2", "H1"],
  ["H1", "M2"],
  ["M2", "Z0"],
  ["H2", "M2"],
  ["MKS2", "M2"],
  ["lambda2", "L2"],
  ["L2", "S2"],
  ["T2", "S2"],
  ["S2", "M2"],
  ["R2", "S2"],
  ["K2", "S2"],
  ["MSN2", "eta2"],
  ["eta2", "K2"],
  ["MO3", "M3"],
  ["M3", "M2"],
  ["SO3", "MK3"],
  ["MK3", "M3"],
  ["SK3", "MK3"],
  ["MN4", "M4"],
  ["M4", "M3"],
  ["SN4", "M4"],
  ["MS4", "M4"],
  ["MK4", "MS4"],
  ["S4", "MS4"],
  ["SK4", "S4"],
  ["2MK5", "M4"],
  ["2SK5", "2MK5"],
  ["2MN6", "M6"],
  ["M6", "2MK5"],
  ["2MS6", "M6"],
  ["2MK6", "2MS6"],
  ["2SM6", "2MS6"],
  ["MSK6", "2SM6"],
  ["3MK7", "M6"],
  ["M8", "3MK7"],
].map(([name, comparison]) => ({ name, comparison }));

export interface SelectionOptions extends FitOptions {
  /** Candidates in priority order. Defaults to `foremanCandidates`. */
  candidates?: readonly Candidate[];
  /** Cycles a pair must separate by over the record. Defaults to 1. */
  rayleigh?: number;
  /** Least SNR a constituent keeps. Defaults to 2, UTide's default. */
  minSnr?: number;
}

export interface ConstituentSelection {
  name: string;
  kept: boolean;
  /** Why a candidate wasn't kept. */
  reason?: "unknown" | "nyquist" | "rayleigh" | "rankDeficient" | "snr";
  /** The constituent a `rayleigh` candidate couldn't be separated from. */
  conflict?: string;
  /** SNR in the returned fit for a kept candidate, and in the fit that cut it for an `snr` one. */
  snr?: number;
}

export interface SelectionResult {
  /** The fit of the kept constituents, with confidence intervals. */
  fit: HarmonicFit;
  /** Every candidate, in candidate order. */
  selection: ConstituentSelection[];
}

/**
 * Choose constituents for a record and fit them. A candidate stays if the
 * catalog knows it, it is below the Nyquist frequency of the median sampling
 * interval, the record separates it from its comparison constituent
 * by the Rayleigh criterion (Foreman 1977, §2.1.2), the fit can tell it from
 * stronger candidates, and its SNR reaches `minSnr`. The kept constituents
 * are then fitted again without the rest, which moves their SNR a little,
 * so a kept constituent's final SNR can fall just under `minSnr`. Throws
 * `invalidSamples` when the record has too few samples to fit every
 * candidate the Rayleigh criterion keeps, with one degree of freedom to spare.
 */
export function selectConstituents(
  samples: readonly HarmonicSample[],
  { candidates = foremanCandidates, rayleigh = 1, minSnr = 2, ...options }: SelectionOptions = {},
): SelectionResult {
  checkWeights(options.weights, samples.length);
  // Samples weighted zero are out of the record, so they don't stretch its span.
  const active = samples.filter((_, i) => !options.weights || options.weights[i] > 0);
  if (active.length < 2) throw new RangeError("invalidSamples");
  const catalog = constituentModels(options.definitions);
  const lookup = (name: string) => (Object.hasOwn(catalog, name) ? catalog[name] : undefined);
  const spanHours = (active[active.length - 1].time.getTime() - active[0].time.getTime()) / 3600000;
  const separated = (a: number, b: number) => (Math.abs(a - b) * spanHours) / 360 >= rayleigh;
  const steps = Float64Array.from(
    active.slice(1),
    (s, i) => s.time.getTime() - active[i].time.getTime(),
  )
    // Repeated timestamps, as from merged sensors, don't shorten the sampling interval.
    .filter((step) => step > 0)
    .sort();
  // Degrees per hour at the Nyquist frequency of the typical sampling interval.
  const nyquist = (180 * 3600000) / steps[steps.length >> 1];

  const comparisons = new Map(candidates.map((c) => [c.name, c.comparison]));
  const selection: ConstituentSelection[] = [];
  const kept: string[] = [];
  for (const { name, comparison } of candidates) {
    const model = lookup(name);
    if (!model) {
      selection.push({ name, kept: false, reason: "unknown" });
      continue;
    }
    // A constituent at or above the Nyquist frequency aliases onto a slower one.
    if (model.speed >= nyquist) {
      selection.push({ name, kept: false, reason: "nyquist" });
      continue;
    }
    // A comparison the catalog lacks passes to its own comparison, as gamma2's H1 passes to M2.
    let other = comparison;
    const visited = new Set<string>();
    while (other && !lookup(other) && !visited.has(other)) {
      visited.add(other);
      other = comparisons.get(other);
    }
    const against = other && lookup(other) ? [other] : kept;
    const conflict = against.find((other) => !separated(model.speed, lookup(other)!.speed));
    if (conflict) selection.push({ name, kept: false, reason: "rayleigh", conflict });
    else {
      selection.push({ name, kept: true });
      kept.push(name);
    }
  }

  const all = fit(samples, kept, { ...options, dropDependent: true, confidence: true });
  const snr = new Map(all.constituents.map((c) => [c.name, c.snr!]));
  for (const entry of selection) {
    if (!entry.kept || all.dropped.includes(entry.name)) continue;
    entry.snr = snr.get(entry.name);
    if (!(entry.snr! >= minSnr)) Object.assign(entry, { kept: false, reason: "snr" });
  }
  const entry = (name: string) => selection.find((s) => s.name === name)!;
  const names = kept.filter((name) => entry(name).kept && !all.dropped.includes(name));
  let result = all;
  if (names.length !== all.constituents.length) {
    // Robust weights shift in the refit, so a column that was independent can stop being so.
    const final = fit(samples, names, { ...options, dropDependent: true, confidence: true });
    // The refit moves each SNR a little; report the one the returned constants carry.
    final.constituents.forEach((c) => (entry(c.name).snr = c.snr));
    result = { ...final, dropped: [...all.dropped, ...final.dropped] };
  }
  for (const name of result.dropped)
    Object.assign(entry(name), { kept: false, reason: "rankDeficient" });
  return { fit: result, selection };
}
