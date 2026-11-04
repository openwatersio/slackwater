import { expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NearbyStations } from "../../src/components/NearbyStations.js";
import { createTestWrapper } from "../helpers.js";

vi.mock("../../src/components/NearbyMap.js", () => ({
  default: ({ focusStation }: { focusStation?: string }) => (
    <span data-testid="map-focus">{focusStation}</span>
  ),
}));

test("a saved tide alias excludes and focuses the canonical station", async () => {
  render(
    <NearbyStations
      stationId="ticon/abashiri-347-jpn-uhslc_fd"
      maxResults={2}
      filter="tide"
      showMap
    />,
    { wrapper: createTestWrapper() },
  );
  const list = await screen.findByRole("list", undefined, { timeout: 10000 });
  const cards = within(list).getAllByRole("listitem");
  expect(cards).toHaveLength(2);
  expect(cards.map((card) => card.querySelector(".truncate")?.textContent)).not.toContain(
    "Abashiri",
  );
  expect((await screen.findByTestId("map-focus")).textContent).toBe("jma/AS");
});
