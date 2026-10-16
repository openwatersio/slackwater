import type { Meta, StoryObj } from "@storybook/react";
import { TideStation } from "./TideStation.js";

const meta: Meta<typeof TideStation> = {
  title: "Stations/TideStation",
  component: TideStation,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof TideStation>;

/** Seattle: spring lows dip below chart datum, where the fill turns amber. */
export const Seattle: Story = { args: { id: "noaa/9447130" } };

/** Boston: lows that stay above datum, so no amber below-datum fill. */
export const Boston: Story = { args: { id: "noaa/8443970" } };

/** Eastport: a big tide whose fastest water climbs the rate ramp toward red. */
export const Eastport: Story = { args: { id: "noaa/8410140" } };

/** Ilwaco: a subordinate station, predicted from its reference with NOAA's offsets. */
export const Subordinate: Story = { args: { id: "noaa/9440597" } };

export const MobileWidth: Story = {
  args: { id: "noaa/9447130" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 390 }}>
        <Story />
      </div>
    ),
  ],
};

export const NotFound: Story = { args: { id: "noaa/0000000" } };
