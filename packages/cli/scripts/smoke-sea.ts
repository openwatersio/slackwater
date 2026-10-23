/**
 * Smoke-test the single executable built by build-sea.ts: it must start,
 * report its version, and predict tides and currents from the embedded station
 * database.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = resolve(root, "dist", `slackwater${process.platform === "win32" ? ".exe" : ""}`);
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function run(args: string[]): string {
  console.log(`$ slackwater ${args.join(" ")}`);
  return execFileSync(binary, args, { encoding: "utf8", timeout: 60_000 });
}

const notice = readFileSync(resolve(root, "dist", "NOTICE"), "utf8");
if (!notice.includes("OpenStreetMap contributors")) {
  throw new Error("dist/NOTICE is missing the station database's attribution");
}

const reported = run(["--version"]).trim();
if (reported !== version) {
  throw new Error(`--version printed "${reported}", expected "${version}"`);
}

const output = run([
  "extremes",
  "--station",
  "noaa/9447130",
  "--start",
  "2026-01-01T00:00:00Z",
  "--end",
  "2026-01-02T00:00:00Z",
  "--format",
  "json",
]);
const { station, extremes } = JSON.parse(output);
if (station?.id !== "noaa/9447130") {
  throw new Error(`extremes returned station ${station?.id}, expected noaa/9447130`);
}
// Seattle has mixed semidiurnal tides: about four extremes a day
if (!Array.isArray(extremes) || extremes.length < 3) {
  throw new Error(`extremes returned ${extremes?.length ?? 0} predictions, expected at least 3`);
}

// Exercises the spatial index built from the embedded database
const nearby = JSON.parse(run(["stations", "--near", "47.6,-122.34", "--format", "json"]));
if (!Array.isArray(nearby) || !nearby.some((s) => s.id === "noaa/9447130")) {
  throw new Error("stations --near 47.6,-122.34 did not include noaa/9447130");
}

// Deception Pass turns about four times a day
const currents = JSON.parse(
  run([
    "currents",
    "--station",
    "noaa/PUG1701",
    "--start",
    "2026-06-01T00:00:00Z",
    "--end",
    "2026-06-02T00:00:00Z",
    "--format",
    "json",
  ]),
);
const slacks = currents.events?.filter((e: { kind: string }) => e.kind === "slack") ?? [];
if (currents.station?.id !== "noaa/PUG1701" || slacks.length < 3) {
  throw new Error(
    `currents returned ${slacks.length} slacks for ${currents.station?.id}, expected at least 3 for noaa/PUG1701`,
  );
}

console.log(
  `OK: ${binary} ${version}, ${extremes.length} extremes for ${station.id}, ${slacks.length} slacks for ${currents.station.id}`,
);
