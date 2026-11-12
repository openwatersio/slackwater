import type { AstroData } from "../astronomy/index.js";
import { iho, type Fundamentals, type NodalCorrection } from "../node-corrections/index.js";
import type { Constituent, ConstituentDefinition, Coefficients } from "./types.js";

/**
 * Build constituents from definitions, keyed by name and alias. Members
 * resolve against `definitions` first, then `base`. A definition that shares
 * a name or alias with a `base` entry replaces that entry under all of the
 * entry's names, but `base` compounds keep the members they already have.
 */
export function defineConstituents(
  definitions: readonly ConstituentDefinition[],
  base: Readonly<Record<string, Constituent>> = {},
): Record<string, Constituent> {
  // No prototype, so names such as "constructor" or "__proto__" are plain keys.
  const registry: Record<string, Constituent> = Object.assign(Object.create(null), base);
  const defined = new Set<string>();
  const built = definitions.map((definition) => {
    validate(definition);
    const constituent = defineConstituent(definition);
    const keys = [constituent.name, ...constituent.aliases];
    const replaced = new Set<Constituent>();
    for (const key of keys) {
      if (defined.has(key)) throw new RangeError(`duplicateConstituent: ${key}`);
      defined.add(key);
      if (Object.hasOwn(registry, key)) replaced.add(registry[key]);
    }
    for (const key of Object.keys(registry)) {
      if (replaced.has(registry[key])) registry[key] = constituent;
    }
    for (const key of keys) registry[key] = constituent;
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
  // value() and correction() recurse through members, so a cycle would overflow the stack.
  const done = new Set<Constituent>();
  const visit = (c: Constituent, path: Set<Constituent>) => {
    if (path.has(c)) throw new RangeError(`cyclicConstituent: ${c.name}`);
    if (done.has(c)) return;
    path.add(c);
    for (const { constituent } of c.members) visit(constituent, path);
    path.delete(c);
    done.add(c);
  };
  for (const c of built) visit(c, new Set());
  return registry;
}

function validate({
  name,
  speed,
  coefficients,
  aliases = [],
  members = [],
}: ConstituentDefinition) {
  const valid =
    typeof name === "string" &&
    Number.isFinite(speed) &&
    (coefficients === null ||
      (coefficients.length === 7 && coefficients.every(Number.isInteger))) &&
    aliases.every((alias) => typeof alias === "string") &&
    members.every(([member, factor]) => typeof member === "string" && Number.isFinite(factor));
  if (!valid) throw new RangeError(`invalidDefinition: ${name}`);
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
      if (Object.hasOwn(fundamentals, name)) return fundamentals[name](astro);

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
