import type { Meta, StoryObj } from "@storybook/react";
import { StationCard, type CardStation } from "./StationCard.js";
import { StationCardFace } from "./StationCardFace.js";

const seattle: CardStation = {
  id: "noaa/9447130",
  name: "Seattle",
  region: "WA",
  country: "United States",
  continent: "Americas",
  latitude: 47.6026,
  longitude: -122.3393,
  timezone: "America/Los_Angeles",
  type: "reference",
  kind: "tide",
};

const deceptionPass: CardStation = {
  id: "noaa/PUG1701",
  name: "Deception Pass (Narrows)",
  region: "Washington",
  country: "United States",
  continent: "Americas",
  latitude: 48.4062,
  longitude: -122.6431,
  timezone: "America/Los_Angeles",
  type: "reference",
  kind: "current",
  predictions: true,
};

const meta: Meta<typeof StationCard> = {
  title: "Components/StationCard",
  component: StationCard,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 390, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: { onSelect: (station) => console.log("Selected:", station) },
};

export default meta;
type Story = StoryObj<typeof StationCard>;

export const Tide: Story = { args: { station: seattle } };

/** A distance shows in nearby lists only. */
export const TideWithDistance: Story = { args: { station: seattle, distance: 2.3 } };

/** Seattle on a spring low under chart datum, where the fill turns amber. */
export const TideBelowDatum: Story = {
  args: { station: seattle, now: Date.parse("2026-06-24T18:00:00Z") },
};

export const Current: Story = { args: { station: deceptionPass, distance: 31.6 } };

/** At a slack, the reading says Slack in green and the set gives way to a dot. */
export const CurrentAtSlack: Story = {
  args: { station: deceptionPass, now: Date.parse("2026-10-15T19:20:00Z") },
};

/** CHS stations can't be served, so the card names the station and says so. */
export const Unavailable: Story = {
  args: {
    station: {
      ...deceptionPass,
      id: "chs-active-pass",
      name: "Active Pass",
      region: "British Columbia",
      country: "Canada",
      predictions: false,
    },
  },
};

/** The skeleton, while the card waits to scroll into view or for its predictions. */
export const Loading: Story = {
  render: () => <StationCardFace name="Seattle" region="WA" loading />,
};
