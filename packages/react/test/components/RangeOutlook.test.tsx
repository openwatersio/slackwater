import { expect, test } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { RangeOutlook } from "../../src/components/RangeOutlook.js";
import { createTestWrapper } from "../helpers.js";
import { addDays, startOfDay } from "../../src/utils/time.js";

test("the shifted outlook loads seven complete days beyond the scrubber window", async () => {
  const timezone = "America/Los_Angeles";
  const anchor = startOfDay(Date.now(), timezone);
  const { container, rerender } = render(
    <RangeOutlook
      id="noaa/9447130"
      anchor={anchor}
      time={addDays(anchor, 5, timezone)}
      timezone={timezone}
    />,
    { wrapper: createTestWrapper() },
  );
  expect(screen.getByRole("img", { name: /^Daily tide ranges:/ })).toBeDefined();
  const bars = () => [...container.querySelectorAll("span")];
  await waitFor(() => expect(bars()).toHaveLength(7), { timeout: 10000 });
  rerender(
    <RangeOutlook
      id="noaa/9447130"
      anchor={anchor}
      time={addDays(anchor, -1, timezone)}
      timezone={timezone}
    />,
  );
  await waitFor(() => expect(bars()).toHaveLength(7), { timeout: 10000 });
});
