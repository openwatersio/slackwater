import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Catalog, type CatalogIndex } from "./catalog.js";
import { createServer } from "./server.js";
import type { Readable, Writable } from "node:stream";

export async function fileCatalog(directory: string) {
  const root = resolve(directory);
  const index = JSON.parse(await readFile(resolve(root, "index.json"), "utf8")) as CatalogIndex;
  return new Catalog(index, async (id) => {
    const file = index.files?.[id];
    if (!file) return undefined;
    return JSON.parse(await readFile(resolve(root, file), "utf8"));
  });
}
export async function startStdio(
  directory: string,
  streams?: { input: Readable; output: Writable },
) {
  const server = createServer(await fileCatalog(directory));
  await server.connect(new StdioServerTransport(streams?.input, streams?.output));
  return server;
}
