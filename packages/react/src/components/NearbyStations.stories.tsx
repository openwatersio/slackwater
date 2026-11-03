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

/** Around Bergen: Kartverket's stations, credited once under the list. */
export const Norway: Story = { args: { latitude: 60.398, longitude: 5.32, maxResults: 3 } };

/** Off the Dutch coast: TICON stations under CC BY 4.0 and CC BY-NC 4.0, each credit once. */
export const MixedLicenses: Story = { args: { latitude: 55.4, longitude: 3.81, maxResults: 4 } };

export const LimitedResults: Story = { args: { stationId: "noaa/9447130", maxResults: 2 } };

export const Error: Story = { args: { stationId: "nonexistent/station" } };
