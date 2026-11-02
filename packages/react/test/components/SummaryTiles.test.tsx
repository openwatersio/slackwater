import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoonGlyph, SummaryTiles } from "../../src/components/SummaryTiles.js";

const TZ = "America/Los_Angeles";
const tiles = (container: HTMLElement) =>
  [...container.querySelectorAll(".sw-card")].map((t) => t.textContent);

describe("SummaryTiles", () => {
  test("the station's number beside the Moon, its glyph marking a standout", () => {
    const { container } = render(
      <SummaryTiles
        time={Date.parse("2024-10-17T11:26:00Z")}
        timezone={TZ}
        primary={{
          label: "Range",
          value: "15.0 ft",
          caption: "the fortnight's biggest",
          marked: true,
        }}
      />,
    );
    expect(tiles(container)).toEqual([
      "Range15.0 ftthe fortnight's biggest",
      "MoonFull MoonPerigean spring tide",
    ]);
    expect(container.querySelector(".sw-card path[d^='M6 1.5']")).not.toBeNull();
  });

  test("the primary spans the narrow pane above equal Moon and Sun cards", () => {
    const { container } = render(
      <div style={{ width: 390 }}>
        <SummaryTiles
          time={Date.parse("2026-10-10T12:00:00Z")}
          timezone="UTC"
          latitude={50}
          longitude={0}
          primary={{ label: "Range", value: "2.0 m", caption: "low to high" }}
        />
      </div>,
    );
    const cards = [...container.querySelectorAll<HTMLElement>(".sw-card")];
    expect(cards).toHaveLength(3);
    expect(cards[2].textContent).toMatch(/^SunSunset.+daylight$/);
    const [water, moon, sun] = cards.map((c) => c.getBoundingClientRect());
    expect(water.bottom).toBeLessThanOrEqual(moon.top);
    expect(moon.top).toBe(sun.top);
    expect(moon.width).toBeCloseTo(sun.width, 0);
  });
  test("a wide pane puts water, Moon and Sun on one row", () => {
    const { container } = render(
      <div style={{ width: 800 }}>
        <SummaryTiles
          time={Date.parse("2026-10-10T12:00:00Z")}
          timezone="UTC"
          latitude={50}
          longitude={0}
          primary={{ label: "Range", value: "2.0 m", caption: "low to high" }}
        />
      </div>,
    );
    const cards = [...container.querySelectorAll<HTMLElement>(".sw-card")].map((c) =>
      c.getBoundingClientRect(),
    );
    expect(cards).toHaveLength(3);
    expect(cards[0].top).toBe(cards[1].top);
    expect(cards[1].top).toBe(cards[2].top);
    expect(cards[0].width).toBeGreaterThan(cards[1].width);
  });
  test("a polar day has no invented sunrise or sunset time", () => {
    render(
      <SummaryTiles
        time={Date.parse("2026-06-21T12:00:00Z")}
        timezone="UTC"
        latitude={85}
        longitude={0}
      />,
    );
    expect(screen.getByText("Sun").closest(".sw-card")!.textContent).toBe("Sun——");
  });
  test("the Moon stands alone without a number, and gives its light when it drives no tide", () => {
    const { container } = render(
      <SummaryTiles time={Date.parse("2024-10-06T12:00:00Z")} timezone={TZ} />,
    );
    expect(tiles(container)).toEqual(["MoonWaxing Crescent12% lit"]);
  });

  test("an unmarked number has no glyph", () => {
    const { container } = render(
      <SummaryTiles
        time={Date.parse("2024-10-06T12:00:00Z")}
        timezone={TZ}
        primary={{ label: "Next max", value: "4.2 kn", caption: "Flood at 8:00 PM" }}
      />,
    );
    expect(container.querySelector(".sw-card path[d^='M6 1.5']")).toBeNull();
  });
});

describe("MoonGlyph", () => {
  test("lit on the right while waxing and mirrored while waning", () => {
    const lit = (waxing: boolean) =>
      render(<MoonGlyph fraction={0.3} waxing={waxing} />).container.querySelector("path")!;
    expect(lit(true).getAttribute("transform")).toBeNull();
    expect(lit(false).getAttribute("transform")).toBe("scale(-1 1)");
  });
});
