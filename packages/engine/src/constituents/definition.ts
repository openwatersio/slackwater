import astro, { type AstroData } from "../astronomy/index.js";
import { iho, type Fundamentals, type NodalCorrection } from "../node-corrections/index.js";
import type { Constituent, ConstituentDefinition, Coefficients } from "./types.js";

/**
 * Build constituents from definitions, keyed by name and alias. Members
 * resolve against `definitions` first, then `base`. A definition that shares
 * a name or alias with a `base` entry replaces that entry under all of the
 * entry's names, but `base` compounds keep the members they already have.
 * Throws a `RangeError` for an invalid definition.
 */
export function defineConstituents(
  definitions: readonly ConstituentDefinition[],
  base: Readonly<Record<string, Constituent>> = {},
): Record<string, Constituent> {
  if (!Array.isArray(definitions as unknown))
    throw new RangeError("invalidDefinition: definitions must be an array");
  // No prototype, so names such as "constructor" or "__proto__" are plain keys.
  const registry: Record<string, Constituent> = Object.assign(Object.create(null), base);
  // Predictors add datum offsets and mean flows as a Z0 term, so Z0 must stay a constant.
  const offset = Object.hasOwn(registry, "Z0") ? registry.Z0 : undefined;
  const built = new Set<Constituent>();
  const constituents = definitions.map((definition) => {
    validate(definition);
    const constituent = defineConstituent(definition);
    const keys = new Set([constituent.name, ...constituent.aliases]);
    const replaced = new Set<Constituent>();
    for (const key of keys) {
      if (!Object.hasOwn(registry, key)) continue;
      // Two definitions for one name, or for two names of one catalog entry.
      if (built.has(registry[key])) throw new RangeError(`duplicateConstituent: ${key}`);
      replaced.add(registry[key]);
    }
    if (replaced.size > 1) {
      throw new RangeError(`invalidDefinition: ${constituent.name} (names two constituents)`);
    }
    if (offset && replaced.has(offset)) {
      throw new RangeError(`invalidDefinition: ${constituent.name} (Z0 carries offsets)`);
    }
    for (const key of Object.keys(registry)) {
      if (!replaced.has(registry[key])) continue;
      registry[key] = constituent;
      // Known by the replaced entry's names, so "MF" still finds Mf's correction formula.
      if (!keys.has(key)) constituent.aliases.push(key);
    }
    for (const key of keys) registry[key] = constituent;
    built.add(constituent);
    return constituent;
  });
  // Second pass, so members can name definitions later in the list.
  definitions.forEach(({ name, members = [] }, i) => {
    constituents[i].members = members.map(([member, factor]) => {
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
  for (const c of constituents) visit(c, new Set());
  // Prediction advances V₀ at `speed` from its start, and extremes restart it each midnight,
  // so an argument that moves at another rate puts extremes off the timeline.
  for (const c of constituents) {
    if (!(Math.abs(argumentRate(c) - c.speed) <= 1e-5)) {
      throw new RangeError(`invalidDefinition: ${c.name} (speed doesn't match its argument)`);
    }
  }
  return registry;
}

const rates = (() => {
  const a = astro(new Date("2026-01-01T00:00:00Z"));
  return [a["T+h-s"].speed, a.s.speed, a.h.speed, a.p.speed, -a.N.speed, a.pp.speed, 0];
})();

/** Degrees per hour at which `value()` advances. */
function argumentRate({ coefficients, members }: Constituent): number {
  if (coefficients) return coefficients.reduce((sum, k, i) => sum + k * rates[i], 0);
  if (!members.length) return Number.NaN;
  return members.reduce(
    (sum, { constituent, factor }) => sum + factor * argumentRate(constituent),
    0,
  );
}

function validate(definition: ConstituentDefinition) {
  const { name, speed, coefficients, aliases = [], members = [] } = definition ?? {};
  const valid =
    typeof name === "string" &&
    name !== "" &&
    Number.isFinite(speed) &&
    // Extremes and slack search assume every line turns forward.
    speed >= 0 &&
    (coefficients === null ||
      (Array.isArray(coefficients) &&
        coefficients.length === 7 &&
        coefficients.every(Number.isInteger))) &&
    Array.isArray(aliases) &&
    aliases.every((alias) => typeof alias === "string" && alias !== "") &&
    Array.isArray(members) &&
    members.every(
      (member) =>
        Array.isArray(member) && typeof member[0] === "string" && Number.isFinite(member[1]),
    );
  if (!valid) throw new RangeError(`invalidDefinition: ${String(name)}`);
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
    aliases: [...aliases],
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
      for (const alias of constituent.aliases) {
        if (Object.hasOwn(fundamentals, alias)) return fundamentals[alias](astro);
      }

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
