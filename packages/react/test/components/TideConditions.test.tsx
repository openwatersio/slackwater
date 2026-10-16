import { describe, test, expect } from "vitest";
import { render, within, waitFor } from "@testing-library/react";
import { WaterLevelAtTime, TideConditions } from "../../src/components/TideConditions.js";
import { createTestWrapper } from "../helpers.js";
import type { Extreme, TimelineEntry } from "../../src/types.js";

// Generate a simple timeline around "now" for testing TideConditionsStatic
const NOW = Date.now();
const HALF_CYCLE = 6.2083 * 60 * 60 * 1000; // ~6h 12.5m

function makeTimeline(count: number): TimelineEntry[] {
  const start = NOW - HALF_CYCLE;
  const step = (2 * HALF_CYCLE) / (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(start + i * step),
    level: Math.sin((i / (count - 1)) * Math.PI * 2) * 1.5,
  }));
}

const timeline = makeTimeline(50);

const extremes: Extreme[] = [
  { time: new Date(NOW - 3 * 60 * 60 * 1000), level: 1.5, high: true, low: false, label: "High" },
  { time: new Date(NOW + 3 * 60 * 60 * 1000), level: -0.3, high: false, low: true, label: "Low" },
];

describe("WaterLevelAtTime", () => {
  test("renders label, level, and time", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={1.5}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
      />,
    );
    const view = within(container);

    expect(view.getByText("Now")).toBeDefined();
    expect(view.getByText("1.50 m")).toBeDefined();
  });

  test("renders state icon when state is provided", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={1.5}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
        state="rising"
      />,
    );
    const view = within(container);

    expect(view.getByLabelText("Rising")).toBeDefined();
  });

  test("renders falling state", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Next"
        level={0.2}
        time={new Date("2025-12-17T18:00:00Z")}
        units="feet"
        locale="en-US"
        state="falling"
      />,
    );
    const view = within(container);

    expect(view.getByLabelText("Falling")).toBeDefined();
    expect(view.getByText("0.2 ft")).toBeDefined();
  });

  test("renders high tide state", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={2.0}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
        state="high"
      />,
    );
    const view = within(container);

    expect(view.getByLabelText("High tide")).toBeDefined();
  });

  test("renders low tide state", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={-0.5}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
        state="low"
      />,
    );
    const view = within(container);

    expect(view.getByLabelText("Low tide")).toBeDefined();
  });

  test("does not render state icon when no state", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={1.0}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
      />,
    );
    const view = within(container);

    expect(view.queryByLabelText("Rising")).toBeNull();
    expect(view.queryByLabelText("Falling")).toBeNull();
    expect(view.queryByLabelText("High tide")).toBeNull();
    expect(view.queryByLabelText("Low tide")).toBeNull();
  });

  test("applies right variant alignment", () => {
    const { container } = render(
      <WaterLevelAtTime
        label="Now"
        level={1.0}
        time={new Date("2025-12-17T12:00:00Z")}
        units="meters"
        locale="en-US"
        variant="right"
      />,
    );

    expect(container.firstElementChild!.className).toContain("items-end");
  });
});

describe("TideConditions", () => {
  test("renders with data props", () => {
    const { container } = render(
      <TideConditions timeline={timeline} extremes={extremes} units="meters" timezone="UTC" />,
      { wrapper: createTestWrapper() },
    );
    const view = within(container);

    // Should show "Now" label
    expect(view.getByText("Now")).toBeDefined();
    // Should show "Next" label
    expect(view.getByText("Next")).toBeDefined();
  });

  test("shows 'No tide data available' with empty timeline", () => {
    const { container } = render(
      <TideConditions timeline={[]} extremes={[]} units="meters" timezone="UTC" />,
      { wrapper: createTestWrapper() },
    );
    const view = within(container);

    expect(view.getByText("No tide data available")).toBeDefined();
  });

  test("applies className", () => {
    const { container } = render(
      <TideConditions
        timeline={timeline}
        extremes={extremes}
        units="meters"
        timezone="UTC"
        className="my-conditions"
      />,
      { wrapper: createTestWrapper() },
    );

    expect(container.querySelector(".my-conditions")).not.toBeNull();
  });

  test("shows rising indicator when next extreme is high", () => {
    const risingExtremes: Extreme[] = [
      {
        time: new Date(NOW + 3 * 60 * 60 * 1000),
        level: 2.0,
        high: true,
        low: false,
        label: "High",
      },
    ];

    const { container } = render(
      <TideConditions
        timeline={timeline}
        extremes={risingExtremes}
        units="meters"
        timezone="UTC"
      />,
      { wrapper: createTestWrapper() },
    );
    const view = within(container);

    expect(view.getByLabelText("Rising")).toBeDefined();
  });

  test("shows falling indicator when next extreme is low", () => {
    const fallingExtremes: Extreme[] = [
      {
        time: new Date(NOW + 3 * 60 * 60 * 1000),
        level: -0.3,
        high: false,
        low: true,
        label: "Low",
      },
    ];

    const { container } = render(
      <TideConditions
        timeline={timeline}
        extremes={fallingExtremes}
        units="meters"
        timezone="UTC"
      />,
      { wrapper: createTestWrapper() },
    );
    const view = within(container);

    expect(view.getByLabelText("Falling")).toBeDefined();
  });
});

describe("TideConditions fetch mode", () => {
  test("fetches and renders conditions by station id", async () => {
    const { container } = render(<TideConditions id="noaa/8443970" />, {
      wrapper: createTestWrapper(),
    });
    const view = within(container);

    expect(view.getByText("Loading...")).toBeDefined();

    await waitFor(
      () => {
        expect(view.queryByText("Loading...")).toBeNull();
      },
      { timeout: 15000 },
    );

    expect(view.getByText("Now")).toBeDefined();
  });

  test("renders an error message when the station does not exist", async () => {
    const { container } = render(<TideConditions id="nonexistent/station" />, {
      wrapper: createTestWrapper(),
    });
    const view = within(container);

    await waitFor(
      () => {
        expect(view.queryByText("Loading...")).toBeNull();
      },
      { timeout: 15000 },
    );

    expect(container.querySelector(".text-\\(--sw-attention\\)")).not.toBeNull();
  });
});
