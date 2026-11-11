import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Catalog } from "./catalog.js";
import { createTools, executeTool } from "./tools.js";

export function createServer(catalog: Catalog) {
  const server = new McpServer(
    { name: "slackwater", version: catalog.index.versions.server },
    {
      instructions:
        "Search for the correct tide or current station and use its exact canonical ID. Never substitute another depth bin or channel when data is unavailable. Times are UTC; render them using the returned station timezone. Preserve units, tide datum and source attribution. Current event kinds are the engine's classifications, not independent validation. A near-zero non-reversing current can remain ebb or flood. Slack windows describe the major axis, not a full-vector minimum or a safe passage. Model predictions are not observations.",
    },
  );
  for (const [name, tool] of Object.entries(createTools(catalog))) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (args: unknown) => executeTool(catalog, name, args),
    );
  }
  return server;
}
