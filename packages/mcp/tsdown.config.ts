import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts", "src/generate.ts", "src/http.ts", "src/worker.ts", "src/stdio.ts"],
  dts: true,
  format: ["esm"],
  platform: "node",
  target: "es2022",
});
