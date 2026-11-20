import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { build, Rolldown } from "tsdown";

const packageRoot = join(import.meta.dirname, "..");
const cache = join(packageRoot, ".test-cache");
let temporary: string;

beforeAll(async () => {
  await mkdir(cache, { recursive: true });
  temporary = await mkdtemp(join(cache, "bundle-"));
  // Consume the real multi-entry package output, not the source aliases used by browser tests.
  await build({
    config: join(packageRoot, "tsdown.config.ts"),
    cwd: packageRoot,
    outDir: join(temporary, "package"),
    dts: false,
    sourcemap: false,
    copy: [],
    logLevel: "error",
  });
});

afterAll(async () => {
  if (temporary) {
    expect(dirname(temporary)).toBe(cache);
    await rm(temporary, { recursive: true, force: true });
  }
});

async function mapImports(entry: string, names: string[]) {
  const consumer = join(temporary, `${names.join("-")}.js`);
  const library = join(temporary, "package", `${entry}.js`).replaceAll("\\", "/");
  await writeFile(
    consumer,
    `import { ${names.join(", ")} } from ${JSON.stringify(library)};\nconsole.log(${names.join(", ")});\n`,
  );
  const bundle = await Rolldown.rolldown({
    input: consumer,
    // Keep third-party imports visible so the assertion checks reachability, not a byte budget.
    external: (id) => !id.startsWith(".") && !isAbsolute(id),
  });
  try {
    const { output } = await bundle.generate({ format: "es" });
    return output
      .filter((chunk) => chunk.type === "chunk")
      .flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports])
      .filter((id) => /^(maplibre-gl|react-map-gl)(\/|$)/.test(id));
  } finally {
    await bundle.close();
  }
}

test("scrubber-only consumers do not retain the lazy map or its stylesheet", async () => {
  expect(
    await mapImports("index", ["TideScrubber", "CurrentScrubber", "useDebouncedCallback"]),
  ).toEqual([]);
});

test.each(["TideStation", "CurrentStation", "NearbyStations"])(
  "%s consumers retain the lazy map",
  async (name) => {
    expect(await mapImports("index", [name])).toContain("maplibre-gl/dist/maplibre-gl.css");
  },
);

test("the explicit map entry retains MapLibre", async () => {
  expect(await mapImports("map", ["StationsMap"])).toContain("maplibre-gl/dist/maplibre-gl.css");
});
