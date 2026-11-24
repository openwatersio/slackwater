import type { AstroData } from "../astronomy/index.js";
import type { NodalCorrection } from "./types.js";

/**
 * u less `turns` of the perigee p, wrapped to ±180°. For an argument that holds p, u then stays
 * near zero and never wraps, so a fractional compound member doesn't jump.
 */
export function withoutPerigee({ f, u }: NodalCorrection, a: AstroData, turns: number) {
  return { f, u: wrap(u - turns * a.p.value) };
}

const wrap = (degrees: number) => degrees - 360 * Math.floor(degrees / 360 + 0.5);
