import { defineProject } from "vitest/config";
import { aliases } from "../../aliases.js";
export default defineProject({
  resolve: { alias: aliases("@slackwater/mcp") },
  test: { name: "mcp", environment: "node" },
});
