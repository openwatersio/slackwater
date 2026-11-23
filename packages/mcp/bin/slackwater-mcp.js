#!/usr/bin/env node
import { startStdio } from "../dist/stdio.mjs";
if (!process.argv[2]) {
  console.error("Usage: slackwater-mcp <generated-catalog-directory>");
  process.exitCode = 1;
} else {
  startStdio(process.argv[2]).catch(() => {
    console.error("Cannot start Slackwater MCP: check the generated catalog directory");
    process.exitCode = 1;
  });
}
