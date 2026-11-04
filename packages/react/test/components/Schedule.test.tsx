import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Schedule } from "../../src/components/Schedule.js";

test.each([
  [360, "system-ui"],
  [360, "monospace"],
  [320, "system-ui"],
  [320, "monospace"],
] as const)("degree bearings and a double-digit current fit %s px with %s", (width, fontFamily) => {
  const anchor = Date.UTC(2026, 10, 3);
  render(
    <div style={{ width, fontFamily }}>
      <Schedule
        days={[
          {
            start: anchor,
            entries: [
              {
                time: anchor + 12 * 3600000,
                pill: "flood",
                value: "12.7 kn axis",
                direction: 31,
              },
              {
                time: anchor + 18 * 3600000,
                pill: "ebb",
                value: "8.1 kn axis",
                direction: 225,
              },
              { time: anchor + 21 * 3600000, pill: "slack" },
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
  const value = screen.getByText("12.7 kn axis");
  const row = value.closest("button")!;
  if (width === 360) expect(row.getBoundingClientRect().height).toBeLessThan(50);
  const pill = row.lastElementChild!.firstElementChild!;
  expect(row.firstElementChild!.getBoundingClientRect().right).toBeLessThanOrEqual(
    value.getBoundingClientRect().left,
  );
  expect(value.getBoundingClientRect().right).toBeLessThanOrEqual(
    pill.getBoundingClientRect().left,
  );
  expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(
    row.closest(".sw-card")!.getBoundingClientRect().right,
  );
  expect(screen.getByText("8.1 kn axis").getBoundingClientRect().right).toBe(
    value.getBoundingClientRect().right,
  );
  expect(screen.getByText("—").getBoundingClientRect().right).toBe(
    value.getBoundingClientRect().right,
  );
});
