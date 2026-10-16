import type { Meta, StoryObj } from "@storybook/react";
import { fireEvent, within } from "storybook/test";
import { SlackwaterProvider } from "../provider.js";
import { StationSearch } from "./StationSearch.js";

const meta: Meta<typeof StationSearch> = {
  title: "Components/StationSearch",
  component: StationSearch,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 800, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: { onSelect: (station) => console.log("Selected:", station) },
};

export default meta;
type Story = StoryObj<typeof StationSearch>;

export const Default: Story = {};

const search = (query: string) =>
  async function play({ canvasElement }: { canvasElement: HTMLElement }) {
    const field = await within(canvasElement).findByRole("searchbox");
    fireEvent.change(field, { target: { value: query } });
  };

/** Tide and current stations together, ranked by where the query matches. */
export const Results: Story = { play: search("Deception") };

/** A broad query stops at sixty results and says so. */
export const Truncated: Story = { play: search("bay") };

export const NoMatches: Story = { play: search("Xyzzy") };

export const CustomPlaceholder: Story = { args: { placeholder: "Find a station" } };

export const Error: Story = {
  play: search("Boston"),
  decorators: [
    (Story) => (
      <SlackwaterProvider baseUrl="http://localhost:1">
        <Story />
      </SlackwaterProvider>
    ),
  ],
};
