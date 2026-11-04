import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Schedule } from "../../src/components/Schedule.js";

test("degree bearings and a double-digit current fit a phone schedule row", () => {
  const anchor = Date.UTC(2026, 10, 3);
  render(
    <div style={{ width: 360, fontFamily: "system-ui" }}>
      <Schedule
        days={[
          {
            start: anchor,
            entries: [
              { time: anchor + 12 * 3600000, pill: "flood", value: "12.7 kn axis", direction: 31 },
            ],
          },
        ]}
        timezone="UTC"
        latitude={48.5}
        longitude={-122.65}
        anchor={anchor}
        now={anchor}
        setFormat="degrees"
        onSelect={() => {}}
        onPick={() => {}}
      />
    </div>,
  );
  expect(screen.getByRole("button", { name: /Published flood bearing 31 degrees/ })).toBeDefined();
  const row = screen.getByText("12.7 kn axis").closest("button")!;
  expect(row.getBoundingClientRect().height).toBeLessThan(50);
  const pill = row.lastElementChild!.firstElementChild!;
  expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(
    row.closest(".sw-card")!.getBoundingClientRect().right,
  );
});
