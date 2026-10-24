import type { Meta, StoryObj } from "@storybook/react";
import { CurrentStation } from "./CurrentStation.js";

const meta: Meta<typeof CurrentStation> = {
  title: "Currents/CurrentStation",
  component: CurrentStation,
  parameters: { layout: "fullscreen" },
  argTypes: { threshold: { control: { type: "range", min: 0.1, max: 10, step: 0.1 } } },
};
export default meta;

type Story = StoryObj<typeof CurrentStation>;

export const DeceptionPass: Story = { args: { id: "noaa/PUG1701", threshold: 0.5 } };

/** A deep bin, selected with `@N`. */
export const DepthBin: Story = { args: { id: "noaa/EPT0003@11" } };

/** Yokeko Point, next to Deception Pass: a moderate channel to compare against the app. */
export const YokekoPoint: Story = { args: { id: "noaa/PUG1629" } };

/** CHS stations can't be served (licensing). */
export const Unavailable: Story = { args: { id: "chs-active-pass" } };
