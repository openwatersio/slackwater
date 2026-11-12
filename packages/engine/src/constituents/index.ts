import { defineConstituents } from "./definition.js";
import type { ConstituentDefinition } from "./types.js";
import data from "./data.json" with { type: "json" };

export type * from "./types.js";
export { defineConstituents };

const constituents = defineConstituents(data as ConstituentDefinition[]);

/** Catalog constituents plus `definitions`, which replace catalog entries of the same name. */
export function constituentModels(definitions?: readonly ConstituentDefinition[]) {
  return definitions != null ? defineConstituents(definitions, constituents) : constituents;
}

export default constituents;
