import { expect, test } from "vitest";
import { nearbyBounds } from "../src/utils/page.js";

test("the nearby map frames its origin and listed stations", () => {
  expect(
    nearbyBounds(48, -123, [
      { latitude: 49, longitude: -122 },
      { latitude: 47, longitude: -124 },
    ]),
  ).toEqual([
    [-124, 47],
    [-122, 49],
  ]);
});

test("nearby stations across the dateline stay in one local map view", () => {
  const [west, east] = nearbyBounds(50, 179.9, [{ latitude: 51, longitude: -179.9 }]);
  expect(west).toEqual([179.9, 50]);
  expect(east[0]).toBeCloseTo(180.1);
  expect(east[1]).toBe(51);
});
