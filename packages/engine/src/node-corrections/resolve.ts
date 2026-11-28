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
 * use a line t_tide doesn't. Predictors also refuse copies of those arguments.
 */
export function checkForemanLine(name: string, model: Constituent, checkArgument = false): void {
  const catalog =
    base[model.name] ?? base[name] ?? model.aliases.map((alias) => base[alias]).find(Boolean);
  if (!catalog || !Object.hasOwn(foremanLines, catalog.name)) return;
  if (
    catalog === model ||
    (checkArgument && catalog.coefficients?.every((value, i) => value === model.coefficients?.[i]))
  )
    throw new RangeError(`notForemanLine: ${name} (t_tide's is ${foremanLines[catalog.name]})`);
}

/**
 * The formulas a predictor corrects `constituents` with, checked as `fit` checks
 * them. Names `models` doesn't know are left for the predictor to skip, except t_tide's
 * H1 and H2, which Foreman's set refuses with the catalog line they mean rather than
 * drop. A null or empty set is IHO's, as the predictors have always read it.
 */
export function predictionCorrections(
  nodeCorrections: NodeCorrections | undefined,
  latitude: number | undefined,
  constituents: readonly { name: string }[],
  models: Record<string, Constituent>,
): Fundamentals {
  const fundamentals = correctionsFor(nodeCorrections || undefined, latitude);
  // A predictor reports constituents that aren't an array itself.
  if (nodeCorrections === "foreman" && Array.isArray(constituents))
    for (const { name } of constituents) {
      if (Object.hasOwn(models, name)) checkForemanLine(name, models[name], true);
      else if (Object.hasOwn(foremanLines, name))
        throw new RangeError(`notForemanLine: ${name} (t_tide's is ${foremanLines[name]})`);
    }
  return fundamentals;
}
