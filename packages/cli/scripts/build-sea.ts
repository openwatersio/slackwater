/**
 * Build a Node.js Single Executable Application (SEA).
 *
 * 1. Bundle ESM sources into a single CJS file with esbuild
 * 2. Build SEA binary with `node --build-sea` (Node 25.5+), embedding the
 *    station database as an SEA asset
 */
import { build, type Plugin } from "esbuild";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "dist");
const bundlePath = resolve(distDir, "sea-bundle.cjs");

const isWindows = process.platform === "win32";
const ext = isWindows ? ".exe" : "";
const outputPath = resolve(distDir, `slackwater${ext}`);

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// @slackwater/database's Node build reads dist/generated/slackwater.tcdb from
// disk relative to import.meta.url, which is empty in a CJS bundle and has no
// file behind it in a single executable. Embed the file as an SEA asset and
// swap the read for node:sea's getAsset.
const DATABASE_ASSET = "slackwater.tcdb";
const databaseEntry = fileURLToPath(import.meta.resolve("@slackwater/database"));
const databaseFile = resolve(dirname(databaseEntry), "../generated/slackwater.tcdb");
// Matches `readFileSync(new URL("../generated/slackwater.tcdb", import.meta.url))`
// in the minified bundle, where readFileSync is an arbitrary local identifier.
const databaseRead =
  /[\w$]+\(\s*new URL\(\s*(["'`])\.\.\/generated\/slackwater\.tcdb\1\s*,\s*import\.meta\.url\s*\)\s*\)/g;

// Windows paths may differ only in drive-letter case between resolvers
const samePath = (a: string, b: string) =>
  isWindows ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

const embedDatabase: Plugin = {
  name: "embed-database",
  setup(build) {
    let patched = false;
    build.onEnd((result) => {
      if (result.errors.length === 0 && !patched) {
        throw new Error(`esbuild never loaded ${databaseEntry}, so the database was not embedded`);
      }
    });
    build.onLoad({ filter: /\.js$/ }, (args) => {
      if (!samePath(args.path, databaseEntry)) {
        // A nested copy would be bundled unpatched and crash at startup
        if (/[\\/]@slackwater[\\/]database[\\/]dist[\\/]node[\\/]index\.js$/.test(args.path)) {
          throw new Error(
            `Found a second copy of @slackwater/database at ${args.path}; dedupe it so only ${databaseEntry} is bundled`,
          );
        }
        return undefined;
      }
      patched = true;
      const source = readFileSync(args.path, "utf8");
      const matches = source.match(databaseRead)?.length ?? 0;
      if (matches !== 1) {
        throw new Error(
          `Expected one database read in ${args.path}, found ${matches}; ` +
            "@slackwater/database changed how it loads slackwater.tcdb, so update build-sea.ts",
        );
      }
      return {
        contents: source.replace(
          databaseRead,
          `new Uint8Array(require("node:sea").getAsset(${JSON.stringify(DATABASE_ASSET)}))`,
        ),
        loader: "js",
      };
    });
  },
};

// Step 1: Bundle ESM → single CJS file
console.log("Bundling with esbuild...");
await build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  minify: true,
  sourcemap: false,
  external: [],
  target: "node25",
  plugins: [embedDatabase],
  // import.meta is empty in CJS, so any read relative to it would fail at runtime
  logOverride: { "empty-import-meta": "error" },
  banner: {
    js: "// Single executable application bundle",
  },
});
console.log(`Bundled to ${bundlePath}`);

// Step 2: Build SEA binary
const configPath = resolve(distDir, "sea-config.json");
writeFileSync(
  configPath,
  JSON.stringify({
    main: "./dist/sea-bundle.cjs",
    output: `./dist/slackwater${ext}`,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    executable: process.execPath,
    assets: { [DATABASE_ASSET]: databaseFile },
  }),
);

console.log("Building SEA binary...");
execFileSync("node", ["--build-sea", configPath], { stdio: "inherit", cwd: root });

// macOS requires ad-hoc signing after injection
if (process.platform === "darwin") {
  console.log("Signing binary (macOS)...");
  execFileSync(
    "codesign",
    ["--sign", "-", "--identifier", "io.openwaters.slackwater-cli", outputPath],
    {
      stdio: "inherit",
    },
  );
}

// The binary redistributes the station database, whose NOTICE carries CC BY
// and ODbL attribution that must travel with it
const databaseDir = resolve(dirname(databaseEntry), "../..");
writeFileSync(resolve(distDir, "LICENSE"), readFileSync(resolve(root, "../../LICENSE")));
writeFileSync(
  resolve(distDir, "NOTICE"),
  [
    "slackwater includes @slackwater/database, distributed under the following terms.\n",
    readFileSync(resolve(databaseDir, "NOTICE"), "utf8"),
    readFileSync(resolve(databaseDir, "LICENSE"), "utf8"),
  ].join("\n"),
);

console.log(`\nSingle executable built: ${outputPath}`);

const stats = statSync(outputPath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
console.log(`Size: ${sizeMB} MB`);
