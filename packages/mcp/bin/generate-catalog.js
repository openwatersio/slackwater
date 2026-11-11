#!/usr/bin/env node
import { loadStations } from "@slackwater/database";
import { readFile } from "node:fs/promises";
import { generateCatalog } from "../dist/generate.mjs";

async function main() {
  if (!process.argv[2]) throw new Error("Usage: generate-catalog <output-directory>");
  const database = await loadStations();
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const engine = JSON.parse(
    await readFile(new URL("../package.json", import.meta.resolve("@slackwater/engine")), "utf8"),
  );
  const db = JSON.parse(
    await readFile(new URL(import.meta.resolve("@slackwater/database/package.json")), "utf8"),
  );
  await generateCatalog(
    database.all,
    { server: pkg.version, engine: engine.version, database: db.version },
    process.argv[2],
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
