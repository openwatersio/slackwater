import type { Meta, StoryObj } from "@storybook/react";
import { NearbyStations } from "./NearbyStations.js";

const meta: Meta<typeof NearbyStations> = {
  title: "Components/NearbyStations",
  component: NearbyStations,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 390, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: { onStationSelect: (station) => console.log("Selected:", station) },
};

export default meta;
type Story = StoryObj<typeof NearbyStations>;

/** Around Deception Pass: tide and current stations together, nearest first. */
export const ByPosition: Story = { args: { latitude: 48.4062, longitude: -122.6431 } };

/** Around a tide station, leaving it out. */
export const ByStation: Story = { args: { stationId: "noaa/9447130" } };

/** Around a current station, leaving it out. */
export const ByCurrentStation: Story = { args: { stationId: "noaa/PUG1701", kind: "current" } };

export const LimitedResults: Story = { args: { stationId: "noaa/9447130", maxResults: 2 } };

export const Error: Story = { args: { stationId: "nonexistent/station" } };
