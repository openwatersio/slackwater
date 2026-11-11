import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { Catalog } from "../src/catalog.js";
import { buildCatalog } from "../src/generate.js";
import { station, versions } from "./fixtures.js";

test("the SDK exposes five read-only tools with structured responses", async () => {
  const built = buildCatalog([station()], versions);
  const server = createServer(new Catalog(built.index, async (id) => built.models.get(id)));
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "find_stations",
      "get_current_prediction",
      "get_slack_windows",
      "get_station",
      "get_tide_prediction",
    ]);
    expect(
      tools.tools.every((t) => t.annotations?.readOnlyHint && t.annotations?.idempotentHint),
    ).toBe(true);
    expect(
      (await client.callTool({ name: "find_stations", arguments: { kind: "tide", query: "port" } }))
        .structuredContent,
    ).toHaveProperty("stations.0.id", "test/port");
    expect(
      (await client.callTool({ name: "get_station", arguments: { station_id: 123 } })).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
