// Emit the constituent catalog as data (Sources/SlackwaterKit/Resources/catalog.json).
// Members resolve by name here, at build time; Swift and Kotlin consume them resolved.
// Each entry: { name, speed, coefficients: [7 ints]|null, members: [[name, factor]]|null }.
// Foreman's nodal correction tables go with it, from the engine's foreman.json.
import { astro, constituents, foremanLines } from '@slackwater/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { writeGenerated } from './write.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'swift', 'Sources', 'SlackwaterKit', 'Resources', 'catalog.json');
const KOTLIN_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kotlin', 'src', 'main', 'kotlin', 'io', 'openwaters', 'slackwater', 'CatalogData.kt');
const KOTLIN_FOREMAN_OUT = join(dirname(KOTLIN_OUT), 'ForemanData.kt');
const FOREMAN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'engine', 'src', 'node-corrections', 'foreman.json');

export function validateCatalog(entries, aliases) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.size !== entries.length) throw new Error('duplicate constituent');
  for (const entry of entries) {
    if (!Number.isFinite(entry.speed)) throw new Error('invalid speed');
    if (entry.coefficients && (entry.coefficients.length !== 7 || !entry.coefficients.every(Number.isInteger))) throw new Error('invalid coefficients');
    for (const member of entry.members ?? []) {
      if (!byName.has(member.name) || !Number.isFinite(member.factor)) throw new Error('invalid member');
    }
  }
  for (const target of Object.values(aliases)) {
    if (!byName.has(target)) throw new Error('invalid alias');
  }
  const active = new Set(), visited = new Set();
  function visit(name) {
    if (active.has(name)) throw new Error('cyclic constituent');
    if (visited.has(name)) return;
    active.add(name);
    for (const member of byName.get(name).members ?? []) visit(member.name);
    active.delete(name);
    visited.add(name);
  }
  for (const entry of entries) visit(entry.name);
}

export function validateForeman({ satellites, products, lines }, entries) {
  const names = new Set(entries.map((entry) => entry.name));
  for (const [name, list] of Object.entries(satellites)) {
    if (!names.has(name)) throw new Error(`Foreman line not in catalog: ${name}`);
    for (const s of list) {
      if (s.length !== 6 || !s.every(Number.isFinite) || ![0, 1, 2].includes(s[5])) throw new Error(`invalid satellite: ${name}`);
    }
  }
  for (const [name, members] of Object.entries(products)) {
    if (!names.has(name)) throw new Error(`Foreman line not in catalog: ${name}`);
    // M1 and NO1 take a perigee count, which the engines don't pass a product's members.
    for (const [member, power] of members) {
      if (!Object.hasOwn(satellites, member) || member === 'M1' || member === 'NO1' || !Number.isFinite(power)) throw new Error(`invalid product: ${name}`);
    }
  }
  // Keys are Foreman's names: Sa, S1 and OQ2 are catalog names for other lines, and H1 and H2 aren't
  // catalog names. Values are the catalog lines he means.
  for (const [name, line] of Object.entries(lines)) {
    if (!Object.hasOwn(satellites, line) && !Object.hasOwn(products, line)) throw new Error(`invalid Foreman line: ${name}`);
  }
}

const kotlinString = (value) => JSON.stringify(value).replaceAll('$', '\\$');
const kotlinDouble = (value) => Number.isInteger(value) ? `${value}.0` : String(value);

// constituents is a map that also includes aliases pointing at the same object.
// De-dup by identity, keyed on the canonical .name. Alias keys (e.g. NOAA's "NU2"
// for canonical "nu2") are captured so real station data resolves correctly.
const seen = new Map();
const aliases = {};
for (const key of Object.keys(constituents)) {
  const c = constituents[key];
  if (!c || !c.name) continue;
  if (key !== c.name) aliases[key] = c.name;
  if (seen.has(c.name)) continue;
  const members = c.members.length ? c.members.map((x) => ({ name: x.constituent.name, factor: x.factor })) : null;
  seen.set(c.name, {
    name: c.name,
    speed: c.speed,
    coefficients: c.coefficients ?? null,
    members,
  });
}

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
// Degrees per hour of each Doodson argument, as defineConstituents checks a definition's speed against them.
const rateState = astro(new Date('2026-01-01T00:00:00Z'));
const argumentRates = [rateState['T+h-s'].speed, rateState.s.speed, rateState.h.speed, rateState.p.speed, -rateState.N.speed, rateState.pp.speed, 0];
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  validateCatalog(entries, aliases);
  const literals = entries.map((entry) => {
    const coefficients = entry.coefficients ? `listOf(${entry.coefficients.join(', ')})` : 'null';
    const members = entry.members ? `listOf(${entry.members.map((member) => `Member(${kotlinString(member.name)}, ${kotlinDouble(member.factor)})`).join(', ')})` : 'emptyList()';
    return `    CatalogEntry(${kotlinString(entry.name)}, ${kotlinDouble(entry.speed)}, ${coefficients}, ${members})`;
  });
  const aliasLiterals = Object.entries(aliases).map(([alias, canonical]) => `    ${kotlinString(alias)} to ${kotlinString(canonical)}`);
  const table = JSON.parse(readFileSync(FOREMAN, 'utf8'));
  const foreman = { source: table.source, satellites: table.satellites, products: table.products, lines: foremanLines };
  validateForeman(foreman, entries);
  writeGenerated(OUT, JSON.stringify({ note: 'Generated from @slackwater/engine. Members pre-resolved.', constituents: entries, aliases, argumentRates, foreman }) + '\n');
  writeGenerated(KOTLIN_OUT, `// Generated by fixtures/generate/gen-catalog.mjs; edit the engine catalog instead.\npackage io.openwaters.slackwater\n\ninternal val catalogEntries = listOf(\n${literals.join(',\n')}\n)\n\ninternal val catalogAliases = mapOf(\n${aliasLiterals.join(',\n')}\n)\n\ninternal val catalogArgumentRates = listOf(${argumentRates.map(kotlinDouble).join(', ')})\n`);
  const satelliteLiterals = Object.entries(foreman.satellites).map(([name, satellites]) =>
    `    ${kotlinString(name)} to listOf<ForemanSatellite>(${satellites.map((s) => `ForemanSatellite(${s.map(kotlinDouble).join(', ')})`).join(', ')})`);
  const productLiterals = Object.entries(foreman.products).map(([name, members]) =>
    `    ${kotlinString(name)} to listOf(${members.map(([member, power]) => `Member(${kotlinString(member)}, ${kotlinDouble(power)})`).join(', ')})`);
  const lineLiterals = Object.entries(foreman.lines).map(([name, line]) => `    ${kotlinString(name)} to ${kotlinString(line)}`);
  writeGenerated(KOTLIN_FOREMAN_OUT, `// Generated by fixtures/generate/gen-catalog.mjs from packages/engine/src/node-corrections/foreman.json.
// ${foreman.source}; see LICENSE.
package io.openwaters.slackwater

/** Each main line's satellites: changes in p, N and p′, phase in cycles, amplitude ratio, latitude factor kind. */
internal val foremanSatellites: Map<String, List<ForemanSatellite>> = linkedMapOf(
${satelliteLiterals.join(',\n')}
)

/** Shallow-water lines as products of main lines, each with its power. */
internal val foremanProducts: Map<String, List<Member>> = linkedMapOf(
${productLiterals.join(',\n')}
)

/** The catalog lines t_tide fits under Foreman's names, where they differ from the catalog's. */
internal val foremanLines: Map<String, String> = mapOf(
${lineLiterals.join(',\n')}
)
`);
  console.log(`${entries.length} constituents, ${Object.keys(aliases).length} aliases, ${Object.keys(foreman.satellites).length + Object.keys(foreman.products).length} Foreman lines`);
}
