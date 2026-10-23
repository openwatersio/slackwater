import { d2r } from "./astronomy/constants.js";
import type { HarmonicSample } from "./fit.js";

/**
 * How every Slackwater client fits a Canadian Hydrographic Service tide port
 * from IWLS `wlp` predictions: `days` of samples on a `sampleMinutes` grid,
 * fitted with `fit(samples, basis)`. Swift's `ChsTideFit` and Kotlin's
 * `ChsTideFit` carry the same values, and all three are checked against
 * `fixtures/chs-tide-fit.json`.
 *
 * The basis has no SA or SSA: a 60-day window cannot separate them from the
 * mean, so a fit carries the mean level of its own window.
 */
export const chsTideFit = {
  basis: [
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
    "MN4",
    "2N2",
    "MU2",
    "NU2",
    "L2",
    "T2",
    "J1",
    "MM",
    "MSF",
    "MF",
    "M6",
    "S4",
    "M3",
  ],
  days: 60,
  sampleMinutes: 15,
} as const satisfies { basis: readonly string[]; days: number; sampleMinutes: number };

/**
 * How every Slackwater client fits a Canadian Hydrographic Service current
 * gate: IWLS `wcsp1` speed and `wcdp1` direction predictions on a
 * `sampleMinutes` grid, combined into signed flood-axis velocity by
 * `projectChsCurrent`, and fitted with `fit(samples, basis)`. Swift's and
 * Kotlin's `ChsCurrentFit` carry the same values, and all three are checked
 * against `fixtures/chs-current-fit.json`.
 *
 * A gate fits over one of `days`, chosen per gate from validation: separating
 * K1 from P1 takes at least 183 days, so most gates need 210. A 210-day gate
 * can publish the fit of its trailing 60 days first, as a provisional answer,
 * when that fit matched every slack and its worst slack error, rounded up to
 * 5 minutes, was measured at or below `provisionalSlackMaxMinutes`.
 */
export const chsCurrentFit = {
  speedSeries: "wcsp1",
  directionSeries: "wcdp1",
  basis: chsTideFit.basis,
  days: [60, 210],
  sampleMinutes: 15,
  provisionalSlackMaxMinutes: 45,
} as const satisfies {
  speedSeries: string;
  directionSeries: string;
  basis: readonly string[];
  days: readonly number[];
  sampleMinutes: number;
  provisionalSlackMaxMinutes: number;
};

/**
 * Signed velocity along a CHS gate's flood axis: speed · cos(direction −
 * floodDirection), positive on the flood. The projection is linear, so fitting
 * it is equivalent to fitting both velocity components and projecting the
 * result. A speed sample without a direction at the same instant is dropped,
 * as is one whose speed or direction is not a finite number (IWLS JSON can
 * carry nulls); when a direction is repeated, its first value counts. Samples
 * come back in the order of `speeds`.
 */
export function projectChsCurrent(
  speeds: readonly HarmonicSample[],
  directions: readonly HarmonicSample[],
  floodDirection: number,
): HarmonicSample[] {
  const directionAt = new Map<number, number>();
  for (const d of directions) {
    const t = d.time.getTime();
    if (!directionAt.has(t)) directionAt.set(t, d.value);
  }
  return speeds.flatMap((s) => {
    const direction = directionAt.get(s.time.getTime());
    if (direction === undefined || !Number.isFinite(direction) || !Number.isFinite(s.value))
      return [];
    return [{ time: s.time, value: s.value * Math.cos((direction - floodDirection) * d2r) }];
  });
}
