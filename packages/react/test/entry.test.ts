import { describe, expect, test } from "vitest";

const sources = import.meta.glob<string>("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every module and package the file reaches through static imports, not `import()`. */
function staticGraph(entry: string) {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = sources[path];
    if (source === undefined) throw new Error(`no source for ${path}`);
    // `import type` and `export type` leave nothing in the build.
    const specifiers = source.matchAll(
      /^(?:import|export)(?!\s+type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm,
    );
    for (const [, from, bare] of specifiers) {
      const specifier = from ?? bare;
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const resolved = new URL(specifier, `file:///${path.slice(3)}`).pathname.slice(1);
      const base = `../${resolved.replace(/\.js$/, "")}`;
      const file = [`${base}.ts`, `${base}.tsx`].find((candidate) => candidate in sources);
      if (!file) throw new Error(`${path} imports ${specifier}, which has no source`);
      visit(file);
    }
  };
  visit(entry);
  return { modules: seen, packages };
}

describe("package entries", () => {
  test("the root entry never statically reaches the stations map or MapLibre", () => {
    const { modules, packages } = staticGraph("../src/index.ts");
    expect(modules.size).toBeGreaterThan(20);
    expect([...modules].filter((m) => m.includes("StationsMap"))).toEqual([]);
    expect([...packages].filter((p) => /maplibre|react-map-gl/.test(p))).toEqual([]);
  });

  test("the map entry carries the stations map", async () => {
    const { modules } = staticGraph("../src/map.ts");
    expect(modules.has("../src/components/StationsMap.tsx")).toBe(true);
    const map = await import("../src/map.js");
    expect(map.StationsMap).toBeDefined();
  });
});
