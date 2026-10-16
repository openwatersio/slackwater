import type { Meta, StoryObj } from "@storybook/react";
import { waitFor, within } from "storybook/test";
import { SlackwaterProvider } from "../provider.js";
import { StationsMap } from "./StationsMap.js";

const meta: Meta<typeof StationsMap> = {
  title: "Components/StationsMap",
  component: StationsMap,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100vw", height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onStationSelect: (station) => console.log("Selected:", station),
  },
};

export default meta;
type Story = StoryObj<typeof StationsMap>;

const SEATTLE = { longitude: -122.3393, latitude: 47.6026 };

/** Puget Sound at the reading zoom: gauges, arrows, and their readings. */
export const SeattleArea: Story = {
  args: { initialViewState: { longitude: -122.45, latitude: 47.65, zoom: 10 } },
};

/** Below the reading zoom every pin is a dot, one per 44 px cell. */
export const USEastCoast: Story = {
  args: { initialViewState: { longitude: -73.5, latitude: 40.2, zoom: 6.5 } },
};

/** The station zoom: pins at full size, with names. */
export const HighZoom: Story = {
  args: { initialViewState: { ...SEATTLE, zoom: 12.5 } },
};

/** A tap on the Seattle gauge shows its card in the bottom panel. */
export const SelectedStation: Story = {
  args: { initialViewState: { ...SEATTLE, zoom: 11.5 } },
  async play({ canvasElement }) {
    await waitFor(
      async () => {
        const canvas = canvasElement.querySelector("canvas")!;
        const rect = canvas.getBoundingClientRect();
        const at = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
        for (const type of ["mousedown", "mouseup", "click"]) {
          canvas.dispatchEvent(new MouseEvent(type, { ...at, bubbles: true }));
        }
        await within(canvasElement).findByRole(
          "button",
          { name: /Seattle|Bergen/ },
          { timeout: 500 },
        );
      },
      { timeout: 30000 },
    );
  },
};

/** Bergen's card, with Kartverket's credit under it and in the map's ⓘ. */
export const NorwayStation: Story = {
  args: { initialViewState: { longitude: 5.320487, latitude: 60.398046, zoom: 11.5 } },
  play: SelectedStation.play,
};

export const Loading: Story = {
  args: { initialViewState: { longitude: -122.45, latitude: 47.65, zoom: 10 } },
  decorators: [
    (Story) => (
      // A non-routable address, so the listing request never answers.
      <SlackwaterProvider baseUrl="http://10.255.255.1">
        <Story />
      </SlackwaterProvider>
    ),
  ],
};

export const Error: Story = {
  args: { initialViewState: { longitude: -122.45, latitude: 47.65, zoom: 10 } },
  decorators: [
    (Story) => (
      <SlackwaterProvider baseUrl="http://localhost:1">
        <Story />
      </SlackwaterProvider>
    ),
  ],
};
