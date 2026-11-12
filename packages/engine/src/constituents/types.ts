import type { AstroData } from "../astronomy/index.js";
import type { Fundamentals, NodalCorrection } from "../node-corrections/types.js";

/**
 * A constituent as data. The catalog in data.json is a list of these, and
 * callers can supply their own to predict or fit lines the catalog doesn't
 * have, or defines differently.
 */
export interface ConstituentDefinition {
  name: string;
  /** Degrees per hour. */
  speed: number;
  /**
   * Doodson numbers for τ, s, h, p, N′ and p′, then the multiple of 90° in
   * the phase, in Schureman's convention: IHO's XDO with D₂ to D₆ less 5 and
   * D₇ as 5 − D₇. Null for a
   * compound whose argument is the sum of its members' arguments.
   */
  coefficients: Coefficients | null;
  aliases?: string[];
  /**
   * Constituents whose nodal corrections combine into this one's, as
   * [name, factor]: u = Σ factor × u, f = Π f^|factor|. Omit for no
   * correction. A constituent whose name or alias is in the node-correction
   * formulas (M2, K1, O1, …) takes its correction from there instead.
   */
  members?: [string, number][];
}

export interface Constituent {
  name: string;
  aliases: string[];
  coefficients: Coefficients | null;
  members: ConstituentMember[];
  speed: number;
  value: (astro: AstroData) => number;
  correction: (astro: AstroData, fundamentals?: Fundamentals) => NodalCorrection;
}

export interface ConstituentMember {
  constituent: Constituent;
  factor: number;
}

export type Coefficients = [number, number, number, number, number, number, number];
