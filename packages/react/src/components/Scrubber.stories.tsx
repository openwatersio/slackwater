import type { Meta, StoryObj } from "@storybook/react";
import { CurrentScrubber } from "./CurrentScrubber.js";
import { TideScrubber } from "./TideScrubber.js";
import { days } from "../utils/time.js";
import type { CurrentEvent, CurrentTimelineEntry, Extreme } from "../types.js";

const HOUR = 3_600_000;
const start = Date.UTC(2026, 9, 10);
const timeline: CurrentTimelineEntry[] = Array.from({ length: 97 }, (_, i) => ({
  time: new Date(start + (i * HOUR) / 4),
  speed: 3 * Math.sin((i * Math.PI) / 24),
}));
const events: CurrentEvent[] = Array.from({ length: 7 }, (_, i) => {
  const h = (i + 1) * 3;
  return {
    time: new Date(start + h * HOUR),
    kind: h % 6 === 0 ? "slack" : h % 12 === 3 ? "maxFlood" : "maxEbb",
    speed: h % 6 === 0 ? 0 : h % 12 === 3 ? 3 : -3,
  };
});
const extremes: Extreme[] = events
  .filter((e) => e.kind !== "slack")
  .map((e) => ({
    time: e.time,
    level: 2 + e.speed / 2,
    label: e.speed > 0 ? "High" : "Low",
    high: e.speed > 0,
    low: e.speed < 0,
  }));
const position = { timezone: "UTC", latitude: 50, longitude: 0, locale: "en-US" };

const meta: Meta = {
  title: "Components/BoundedScrubber",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 736, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj;

export const CurrentDay: Story = {
  render: () => (
    <CurrentScrubber
      {...position}
      timeline={timeline}
      events={events}
      now={start + 2 * HOUR}
      bounded
    />
  ),
};

export const TideDay: Story = {
  render: () => (
    <TideScrubber
      {...position}
      timeline={timeline.map((p) => ({ time: p.time, level: 2 + p.speed / 2 }))}
      extremes={extremes}
      units="meters"
      now={start + 22 * HOUR}
      bounded
    />
  ),
};

export const PartialCurrentDay: Story = {
  render: () => (
    <CurrentScrubber
      {...position}
      timeline={timeline.slice(0, 17)}
      events={events.filter((e) => +e.time <= start + 4 * HOUR)}
      now={start + 2 * HOUR}
      bounded
    />
  ),
};

export const SunriseAtWindowStart: Story = {
  render: () => {
    const sunrise = days(start, start + HOUR, "UTC", 50, 0)[0].sunrise!;
    const offset = sunrise - start - 10 * 60_000;
    return (
      <CurrentScrubber
        {...position}
        timeline={timeline.slice(0, 17).map((p) => ({ ...p, time: new Date(+p.time + offset) }))}
        events={events
          .filter((e) => +e.time <= start + 4 * HOUR)
          .map((e) => ({ ...e, time: new Date(+e.time + offset) }))}
        now={sunrise}
        bounded
      />
    );
  },
};
