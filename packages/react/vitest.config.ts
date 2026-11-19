import { defineProject } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
import { aliases } from "../../aliases.js";

export default defineProject({
  plugins: [tailwindcss()],
  resolve: {
    alias: aliases("@slackwater/react"),
  },
  optimizeDeps: {
    // Pre-bundling separates MapLibre from the worker it loads relative to itself,
    // so the map would request a worker that isn't there and never render a tile.
    exclude: ["maplibre-gl"],
    // Found late, these reload the browser mid-run, failing the server-render tests that import them.
    include: ["react-dom/client", "react-dom/server"],
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright({ contextOptions: { locale: "en-US" } }),
      instances: [
        {
          browser: "chromium",
          headless: true,
          // Desktop-sized so components render in their full (non-tabbed)
          // layout by default; compact tests use fixed-size wrappers instead.
          viewport: { width: 1280, height: 800 },
        },
      ],
    },
    setupFiles: ["./test/setup.ts"],
    globalSetup: ["./test/globalSetup.ts", "./test/node-render.tsx"],
  },
});
