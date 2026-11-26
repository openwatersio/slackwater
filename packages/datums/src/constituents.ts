import {
  constituents as catalog,
  defineConstituents,
  type ConstituentDefinition,
  type HarmonicConstituent,
} from "@slackwater/engine";

export interface ResolvedConstituents {
  /** The constituents the engine predicts, in the order given. */
  known: HarmonicConstituent[];
  /** Names the engine doesn't know and skips, in the order given. */
  ignored: string[];
  /** Names given for a constituent already given, which the engine adds as a second wave. */
  duplicates: string[];
  /**
   * The constants for the constituent the engine knows by `name`, through any alias or
   * definition, so "SA" finds Sa and a definition that takes the name "M2" finds its own entry.
   */
  find(name: string): HarmonicConstituent | undefined;
}

/** Sort constants into the ones the engine predicts and the names it skips, as the engine does. */
export function resolveConstituents(
  constituents: readonly HarmonicConstituent[],
  definitions?: readonly ConstituentDefinition[],
): ResolvedConstituents {
  const registry = definitions != null ? defineConstituents(definitions, catalog) : catalog;
  const model = (name: string) => (Object.hasOwn(registry, name) ? registry[name] : undefined);
  const known: HarmonicConstituent[] = [];
  const ignored: string[] = [];
  const duplicates: string[] = [];
  const byModel = new Map<object, HarmonicConstituent>();
  for (const constituent of constituents) {
    const entry = model(constituent.name);
    if (!entry) {
      ignored.push(constituent.name);
      continue;
    }
    if (byModel.has(entry)) duplicates.push(constituent.name);
    else byModel.set(entry, constituent);
    known.push(constituent);
  }
  return {
    known,
    ignored,
    duplicates,
    find: (name) => {
      const entry = model(name);
      return entry && byModel.get(entry);
    },
  };
}
