import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

  test("with no moment, the server render reads nothing, and the tiles keep their size", () => {
    const props = {
      timezone: "UTC",
      latitude: 50,
      longitude: 0,
      className: "",
    };
    const html = renderToString(
      <SummaryTiles {...props} primary={{ label: "Range", value: "—", caption: "" }} />,
    );
    expect(html).not.toMatch(/Moon<\/span>.*(Full|New|Crescent|Gibbous|Quarter)/);
    expect(html).not.toMatch(/Sunrise|Sunset|daylight|% lit/);
    expect(html).not.toContain("--sw-moon-limb"); // no Moon glyph claims a phase
    const box = (time?: number, place: { latitude?: number; longitude?: number } = props) => {
      const { container, unmount } = render(
        <div style={{ width: 390 }}>
          <SummaryTiles
            {...props}
            {...place}
            time={time}
            primary={{
              label: "Range",
              value: time ? "2.0 m" : "—",
              caption: time ? "low to high" : "",
            }}
          />
        </div>,
      );
      const heights = [...container.querySelectorAll<HTMLElement>(".sw-card")].map(
        (c) => c.getBoundingClientRect().height,
      );
      unmount();
      return heights;
    };
    const day = Date.parse("2026-10-10T12:00:00Z");
    expect(box()).toEqual(box(day));
    // A lone Moon, with no Sun card beside it to hold the row's height.
    const nowhere = { latitude: undefined, longitude: undefined };
    expect(box(undefined, nowhere)).toEqual(box(day, nowhere));
    // A polar day, whose Sun names no sunrise or sunset.
    const pole = { latitude: 85, longitude: 0 };
    expect(box(undefined, pole)).toEqual(box(Date.parse("2026-06-21T12:00:00Z"), pole));
    expect(box(day, pole)).toEqual(box(day));
  });

  test("the longest captions keep the size the tiles have with no moment, on a narrow phone", () => {
    const box = (time?: number) => {
      const { container, unmount } = render(
        <div style={{ width: 320 }}>
          <SummaryTiles
            timezone="UTC"
            latitude={50}
            longitude={0}
            className=""
            time={time}
            primary={{
              label: "Range",
              value: time ? "15.0 ft" : "—",
              caption: time ? "the fortnight's biggest" : "",
              marked: !!time,
            }}
            outlook={<div className="h-[62px] w-[45%] shrink-0" />}
          />
        </div>,
      );
      const heights = [...container.querySelectorAll<HTMLElement>(".sw-card")].map(
        (c) => c.getBoundingClientRect().height,
      );
      const moon = container.querySelectorAll(".sw-card")[1].textContent;
      unmount();
      return { heights, moon };
    };
    // A perigean full moon, whose caption is the Moon's longest.
    const perigee = box(Date.parse("2024-10-17T11:26:00Z"));
    expect(perigee.moon).toContain("Perigean spring tide");
    expect(box().heights).toEqual(perigee.heights);
  });

  test("a time that isn't a number, or is at the far ends of the Date range, reads as no moment", () => {
    for (const time of [NaN, Infinity, 1e16, 8.64e15]) {
      const { container, unmount } = render(
        <SummaryTiles time={time} timezone="UTC" latitude={50} longitude={0} className="" />,
      );
      expect(tiles(container), String(time)).toEqual(["Moon—", "Sun—"]);
      unmount();
    }
  });

  test("the supported interval reads at both ends", () => {
    for (const time of [Date.parse("1950-01-01T00:00:00Z"), Date.parse("2100-12-31T23:59:59Z")]) {
      const { container, unmount } = render(
        <SummaryTiles time={time} timezone="UTC" latitude={50} longitude={0} className="" />,
      );
      const [moon, sun] = tiles(container);
      expect(moon, String(time)).toMatch(/^Moon(?!—)/);
      expect(sun, String(time)).toMatch(/^Sun/);
      unmount();
    }
  });

  test.each([
    ["1950-01-01T00:00:00Z", "America/Los_Angeles"],
    ["2100-12-31T23:59:59Z", "Pacific/Auckland"],
  ])("reads %s when the local day crosses a boundary", (date, timezone) => {
    const { container, unmount } = render(
      <SummaryTiles time={Date.parse(date)} timezone={timezone} latitude={48} longitude={-123} />,
    );
    expect(tiles(container)[0]).toMatch(/^Moon(?!—)/);
    unmount();
  });

  test("a time outside the supported interval reads as no moment", () => {
    for (const time of [Date.parse("1949-12-31T23:59:59Z"), Date.parse("2101-01-01T00:00:00Z")]) {
      const { container, unmount } = render(
        <SummaryTiles time={time} timezone="UTC" latitude={50} longitude={0} />,
      );
      expect(tiles(container)).toEqual(["Moon—", "Sun—"]);
      unmount();
    }
  });

  test("a className replaces the station page's margins", () => {
    const { container } = render(<SummaryTiles timezone={TZ} className="mt-6" />);
    expect((container.firstChild as HTMLElement).className).toBe("@container/sw-summary mt-6");
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
