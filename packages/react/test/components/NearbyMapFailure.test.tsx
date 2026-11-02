import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { lazy, Suspense } from "react";
import { MapBoundary } from "../../src/components/MapBoundary.js";

test("a failed map download leaves the rest of the station page usable", async () => {
  const UnavailableMap = lazy(() => Promise.reject(new Error("Map chunk unavailable")));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <>
        <h1>Station page</h1>
        <ul>
          <li>Nearby station</li>
        </ul>
        <MapBoundary>
          <Suspense fallback="Loading map">
            <UnavailableMap />
          </Suspense>
        </MapBoundary>
      </>,
    );
    expect(await screen.findByText("Map unavailable.")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Station page" })).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  } finally {
    errors.mockRestore();
  }
});
