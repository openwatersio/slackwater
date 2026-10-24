import { describe, test, expect } from "vitest";
import { render, within, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { TideTable } from "../src/components/TideTable.js";
import { StationSearch } from "../src/components/StationSearch.js";
import { NearbyStations } from "../src/components/NearbyStations.js";
import { TideStation } from "../src/components/TideStation.js";
import { TideGraphChart } from "../src/components/TideGraph/index.js";
import { CurrentStation } from "../src/components/CurrentStation.js";
import { createTestWrapper } from "./helpers.js";

async function checkA11y(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  if (results.violations.length > 0) {
    const message = results.violations
      .map((v) => `${v.id}: ${v.description} (${v.nodes.length} nodes)`)
      .join("\n");
    throw new Error(`Accessibility violations:\n${message}`);
  }
}

const STATION_ID = "noaa/8443970";

describe("accessibility", () => {
  test("TideTable with data has no violations", async () => {
    const extremes = [
      { time: new Date("2025-12-17T04:30:00Z"), level: 1.5, high: true, low: false, label: "High" },
      { time: new Date("2025-12-17T10:45:00Z"), level: 0.2, high: false, low: true, label: "Low" },
      { time: new Date("2025-12-17T16:00:00Z"), level: 1.4, high: true, low: false, label: "High" },
    ];

    const { container } = render(<TideTable extremes={extremes} timezone="UTC" units="meters" />, {
      wrapper: createTestWrapper(),
    });

    await checkA11y(container);
  });

  test("StationSearch has no violations", async () => {
    const { container } = render(<StationSearch onSelect={() => {}} />, {
      wrapper: createTestWrapper(),
    });

    await checkA11y(container);
  });

  test("NearbyStations has no violations after loading", async () => {
    const { container } = render(<NearbyStations stationId={STATION_ID} />, {
      wrapper: createTestWrapper(),
    });
    const view = within(container);

    await waitFor(
      () => {
        expect(view.queryByText(/Loading/)).toBeNull();
      },
      { timeout: 10000 },
    );

    await checkA11y(container);
  });

  test("TideStation has no violations after loading", { timeout: 15000 }, async () => {
    const { container } = render(<TideStation id={STATION_ID} />, { wrapper: createTestWrapper() });
    const view = within(container);

    await waitFor(
      () => {
        expect(view.queryByText("Loading...")).toBeNull();
      },
      { timeout: 10000 },
    );

    await checkA11y(container);
  });

  test("TideStation compact (tabbed) layout has no violations", { timeout: 15000 }, async () => {
    const { container } = render(
      <div style={{ width: 400, height: 320 }}>
        <TideStation id={STATION_ID} />
      </div>,
      { wrapper: createTestWrapper() },
    );
    const view = within(container);

    await waitFor(
      () => {
        expect(view.queryByText("Loading...")).toBeNull();
        expect(view.getByRole("tablist")).toBeDefined();
      },
      { timeout: 10000 },
    );

    await checkA11y(container);
  });

  test(
    "TideStation dropdown (short container) layout has no violations",
    { timeout: 15000 },
    async () => {
      const { container } = render(
        <div style={{ width: 400, height: 220 }}>
          <TideStation id={STATION_ID} />
        </div>,
        { wrapper: createTestWrapper() },
      );
      const view = within(container);

      await waitFor(
        () => {
          expect(view.queryByText("Loading...")).toBeNull();
          expect(view.getByRole("combobox", { name: "Section" })).toBeDefined();
        },
        { timeout: 10000 },
      );

      await checkA11y(container);
    },
  );

  test("TideGraphChart with data has no violations", async () => {
    const timeline = [
      { time: new Date("2025-12-17T00:00:00Z"), level: 0.5 },
      { time: new Date("2025-12-17T06:00:00Z"), level: 1.5 },
      { time: new Date("2025-12-17T12:00:00Z"), level: 0.3 },
      { time: new Date("2025-12-17T18:00:00Z"), level: 1.4 },
    ];

    const { container } = render(
      <TideGraphChart
        timeline={timeline}
        extremes={[]}
        timezone="UTC"
        units="meters"
        svgWidth={600}
        onSelect={() => {}}
      />,
      {
        wrapper: createTestWrapper(),
      },
    );

    await checkA11y(container);
  });

  test("CurrentStation has no violations after loading", { timeout: 15000 }, async () => {
    const { container } = render(<CurrentStation id="noaa/PUG1701" />, {
      wrapper: createTestWrapper(),
    });
    const view = within(container);

    await waitFor(() => expect(view.getByRole("slider")).toBeDefined(), { timeout: 10000 });

    await checkA11y(container);
  });
});
