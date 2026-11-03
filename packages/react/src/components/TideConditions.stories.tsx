import type { Meta, StoryObj } from "@storybook/react";
import { TideConditions } from "./TideConditions.js";

const meta: Meta<typeof TideConditions> = {
  title: "Components/TideConditions",
  component: TideConditions,
  decorators: [
    (Story) => (
      <div style={{ width: 170, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TideConditions>;

export const Default: Story = { args: { id: "noaa/9447130" } };

/** The smaller widget older phones show. */
export const Small: Story = {
  args: { id: "noaa/8443970" },
  decorators: [
    (Story) => (
      <div style={{ width: 155 }}>
        <Story />
      </div>
    ),
  ],
};

/** `fill` takes the parent's height, as a dashboard tile does. */
export const Fill: Story = {
  args: { id: "noaa/9447130", fill: true },
  decorators: [
    (Story) => (
      <div style={{ width: 340, height: 220 }}>
        <Story />
      </div>
    ),
  ],
};

/** A Kartverket station, whose CC BY 4.0 credit sits under the widget. */
export const Credited: Story = { args: { id: "kartverket/BGO" } };

export const NoData: Story = {
  args: { timeline: [], extremes: [], units: "feet", timezone: "UTC" },
};
