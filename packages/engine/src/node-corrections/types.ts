import type { AstroData } from "../astronomy/index.js";

export interface NodalCorrection {
  f: number; // amplitude factor
  u: number; // phase correction in degrees
}

/**
 * `perigeeTurns` is how many turns of the lunar perigee p the argument being
 * corrected holds: a formula written for an argument without p takes them off u.
 */
export type CorrectionFn = (astro: AstroData, perigeeTurns: number) => NodalCorrection;
export type Fundamentals = Record<string, CorrectionFn>;
