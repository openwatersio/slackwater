import { expect, test } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStdio, fileCatalog } from "../src/stdio.js";
import { generateCatalog } from "../src/generate.js";
import { station, versions } from "./fixtures.js";

test("stdio carries only protocol JSON and uses the generated catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-stdio-"));
  const input = new PassThrough(),
    output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  await generateCatalog([station()], versions, directory);
  const server = await startStdio(directory, { input, output });
  try {
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }) + "\n",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(text.trim()).result.serverInfo.version).toBe(versions.server);
    text = "";
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(text.trim()).result.tools).toHaveLength(5);
    const catalog = await fileCatalog(directory);
    expect((await catalog.model("test/port")).id).toBe("test/port");
    expect((await catalog.model("test/port")).chart_datum).toBe("MLLW");
    const index = await generateCatalog([station()], versions, directory);
    delete index.files;
    await writeFile(join(directory, "index.json"), JSON.stringify(index));
    await expect((await fileCatalog(directory)).model("test/port")).rejects.toThrow(
      /does not match/,
    );
  } finally {
    await server.close();
    input.destroy();
    output.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
