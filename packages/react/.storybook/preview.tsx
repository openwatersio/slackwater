import type { Preview } from "@storybook/react";
import { SlackwaterProvider } from "../src/provider.js";
import "./storybook.css";

// STORYBOOK_API_URL points static builds (e.g. GitHub Pages) at a public API;
// the default targets the local API started by the Storybook dev server.
const API_URL =
  import.meta.env.STORYBOOK_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:6007`;

const preview: Preview = {
  decorators: [
    (Story) => (
      <SlackwaterProvider baseUrl={API_URL}>
        <Story />
      </SlackwaterProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
