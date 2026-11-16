import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/map.ts"],
  dts: true,
  format: ["esm"],
  sourcemap: true,
  target: "es2020",
  platform: "browser",
  deps: {
    neverBundle: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "maplibre-gl",
      "react-map-gl",
      "react-map-gl/maplibre",
      "maplibre-gl/dist/maplibre-gl.css",
    ],
  },
  copy: ["./src/styles.css"],
});
