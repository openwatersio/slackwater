import { defineProject } from "vitest/config";

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: "react-bundle",
    environment: "node",
    include: ["test/bundle.check.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
