import { describe, test, expect } from "vitest";
import { fireEvent, render, within, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { StationSearch } from "../src/components/StationSearch.js";
import { NearbyStations } from "../src/components/NearbyStations.js";
import { TideStation } from "../src/components/TideStation.js";
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

    await waitFor(() => expect(view.getByRole("slider")).toBeDefined(), { timeout: 10000 });
    fireEvent.click(view.getByText("Station details"));

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
