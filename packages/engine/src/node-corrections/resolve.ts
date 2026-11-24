import { constituentModels } from "../constituents/index.js";
import type { Constituent } from "../constituents/types.js";
import { foreman, foremanLines } from "./foreman.js";
import { resolveFundamentals } from "./index.js";
import type { Fundamentals } from "./types.js";

/** A set of nodal correction formulas. */
export type NodeCorrections = "iho" | "schureman" | "foreman";

const base = constituentModels();

/**
 * The formulas for `nodeCorrections`, IHO's by default. Foreman's take the site's
 * `latitude`, which no other set uses, so a latitude given with another set is a mistake.
 */
export function correctionsFor(
  nodeCorrections: NodeCorrections | undefined,
  latitude: number | undefined,
): Fundamentals {
  if (nodeCorrections !== undefined && !["iho", "schureman", "foreman"].includes(nodeCorrections))
    throw new RangeError(`invalidNodeCorrections: ${nodeCorrections}`);
  if ((nodeCorrections === "foreman") !== (latitude !== undefined))
    throw new RangeError("invalidLatitude");
  return nodeCorrections === "foreman" ? foreman(latitude!) : resolveFundamentals(nodeCorrections);
}

/**
 * Refuse a catalog line t_tide knows by another name. The catalog's Sa, S1 and OQ2 are
 * other lines than t_tide's by those names, so correcting them with Foreman's set would
 * use a line t_tide doesn't. A caller's own definition is its own.
 */
export function checkForemanLine(name: string, model: Constituent): void {
  if (
    Object.hasOwn(foremanLines, model.name) &&
    Object.hasOwn(base, model.name) &&
    base[model.name] === model
  )
    throw new RangeError(`notForemanLine: ${name} (t_tide's is ${foremanLines[model.name]})`);
}

/**
 * The formulas a predictor corrects `constituents` with, checked as `fit` checks
 * them. Names `models` doesn't know are left for the predictor to skip.
 */
export function predictionCorrections(
  nodeCorrections: NodeCorrections | undefined,
  latitude: number | undefined,
  constituents: readonly { name: string }[],
  models: Record<string, Constituent>,
): Fundamentals {
  const fundamentals = correctionsFor(nodeCorrections, latitude);
  if (nodeCorrections === "foreman")
    for (const { name } of constituents)
      if (Object.hasOwn(models, name)) checkForemanLine(name, models[name]);
  return fundamentals;
}
