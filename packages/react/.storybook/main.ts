import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { createApp } from "@slackwater/api";
import { fileURLToPath } from "node:url";

const mapLibreSetup = fileURLToPath(new URL("./maplibre.ts", import.meta.url));

const API_PORT = 6007;

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-themes"],
  staticDirs: [{ from: "../../../brand", to: "/brand" }],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal(config) {
    config.plugins ??= [];
    config.plugins.push(tailwindcss());
    config.optimizeDeps ??= {};
    config.optimizeDeps.exclude = [...(config.optimizeDeps.exclude ?? []), "maplibre-gl"];
    config.plugins.push({
      name: "slackwater:maplibre-worker-url",
      enforce: "pre",
      resolveId(source: string, importer?: string) {
        if (source === "maplibre-gl" && importer !== mapLibreSetup) return mapLibreSetup;
      },
    });
    config.plugins.push({
      name: "slackwater-api",
      async configureServer() {
        const app = createApp();
        app.listen(API_PORT, "0.0.0.0", () => {
          console.log(`Slackwater API listening on http://0.0.0.0:${API_PORT}`);
        });
      },
    });
    return config;
  },
};

export default config;
