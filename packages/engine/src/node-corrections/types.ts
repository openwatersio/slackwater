import type { AstroData } from "../astronomy/index.js";

export interface NodalCorrection {
  f: number; // amplitude factor
  u: number; // phase correction in degrees
}

/**
 * `perigeeTurns` is how many turns of the lunar perigee p the argument being
 * corrected holds, when it isn't the catalog's: a formula written for an
 * argument without p takes them off u. `epoch` is the astronomy the argument is
 * evaluated at, when not `astro`, and gives the p taken off.
 */
export type CorrectionFn = (
  astro: AstroData,
  perigeeTurns?: number,
  epoch?: AstroData,
) => NodalCorrection;
export type Fundamentals = Record<string, CorrectionFn>;
