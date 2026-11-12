import type { AstroData } from "../astronomy/index.js";
import { iho, type Fundamentals, type NodalCorrection } from "../node-corrections/index.js";
import type { Constituent, ConstituentDefinition, Coefficients } from "./types.js";

/**
 * Build constituents from definitions, keyed by name and alias. Members
 * resolve against `definitions` first, then `base`. A definition replaces a
 * `base` entry of the same name or alias for lookups, but `base` compounds
 * keep the members they already have.
 */
export function defineConstituents(
  definitions: readonly ConstituentDefinition[],
  base: Readonly<Record<string, Constituent>> = {},
): Record<string, Constituent> {
  const registry: Record<string, Constituent> = { ...base };
  const built = definitions.map((definition) => {
    const constituent = defineConstituent(definition);
    for (const key of [constituent.name, ...constituent.aliases]) registry[key] = constituent;
    return constituent;
  });
  // Second pass, so members can name definitions later in the list.
  definitions.forEach(({ name, members = [] }, i) => {
    built[i].members = members.map(([member, factor]) => {
      if (!Object.hasOwn(registry, member)) {
        throw new RangeError(`unknownConstituent: ${member} (member of ${name})`);
      }
      return { constituent: registry[member], factor };
    });
  });
  return registry;
}

/** A constituent with no members yet; `defineConstituents` resolves them. */
function defineConstituent({
  name,
  speed,
  coefficients,
  aliases = [],
}: ConstituentDefinition): Constituent {
  const constituent: Constituent = {
    name,
    speed,
    aliases,
    coefficients,
    members: [],

    value(astro: AstroData): number {
      if (coefficients) return computeV0(coefficients, astro);

      // Compound without coefficients: V₀ = Σ factor × V₀(member)
      let v = 0;
      for (const { constituent: c, factor } of constituent.members) {
        v += c.value(astro) * factor;
      }
      return v;
    },

    correction(astro: AstroData, fundamentals: Fundamentals = iho): NodalCorrection {
      // Fundamentals have their own correction formula
      const fundamental = fundamentals[name];
      if (fundamental) return fundamental(astro);

      // Start with UNITY
      let f = 1;
      let u = 0;

      // Compound: recurse through members
      // u = Σ factor × u(member), f = Π f(member)^|factor|
      for (const { constituent: member, factor } of constituent.members) {
        const corr = member.correction(astro, fundamentals);
        u += factor * corr.u;
        f *= Math.pow(corr.f, Math.abs(factor));
      }

      return { u, f };
    },
  };

  return constituent;
}

/**
 * Compute V₀ using Doodson coefficients and standard astronomical arguments.
 * Uses N' = −N from the existing astronomy module's N value.
 */
export function computeV0(coefficients: Coefficients, astro: AstroData): number {
  const values = [
    astro["T+h-s"].value, // τ
    astro.s.value, // s
    astro.h.value, // h
    astro.p.value, // p
    -astro.N.value, // N' = −N
    astro.pp.value, // p'
    90.0, // constant phase
  ];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += coefficients[i] * values[i];
  }
  return sum;
}
