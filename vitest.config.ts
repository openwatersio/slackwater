import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
    },
    projects: ["packages/*", "packages/react/vitest.bundle.config.ts", "benchmarks"],
    environment: "node",
    setupFiles: [resolve(__dirname, "./test/setup.ts")],
    coverage: {
      include: ["**/src/**"],
      exclude: ["**/*.stories.tsx"],
    },
  },
});
