import { defineProject } from "vitest/config";

// Only the contract tests: the benchmarks themselves run under `node`, against live data.
export default defineProject({
  test: {
    name: "benchmarks",
    environment: "node",
    include: ["*.test.ts"],
  },
});
