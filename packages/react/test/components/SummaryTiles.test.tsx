import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
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
