import { expect, test } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { StationCardGraph, type CardGraphData } from "../../src/components/StationCardGraph.js";

const T0 = Date.UTC(2026, 9, 15, 12);
const H = 3_600_000;
const at = (hours: number) => new Date(T0 + hours * H);
const data: CardGraphData = {
  kind: "current",
  timeline: [-12, 0, 12].map((h, i) => ({ time: at(h), speed: i === 1 ? -3 : 3 })),
  events: [-6, 6].map((h) => ({ time: at(h), speed: 0, kind: "slack" })),
  runs: [
    { start: at(-7), end: at(-5) },
    { start: at(6 - 5 / 60), end: at(6 + 1 / 60) },
  ],
};

test("current cards draw blue windows, short green zero strokes and exact times for narrow windows", async () => {
  const graph = (runs = data.runs) => (
    <div style={{ width: 360, height: 120, position: "relative" }}>
      <StationCardGraph data={{ ...data, runs }} now={T0} timezone="UTC" locale="en-US" />
    </div>
  );
  const { container, rerender } = render(graph());
  await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  const green = () =>
    [...container.querySelectorAll('path[stroke-width="3.5"]')].filter((p) =>
      p.getAttribute("stroke")?.includes("sw-go"),
    );
  const blue = () =>
    [...container.querySelectorAll('path[stroke-width="3.5"]')].filter((p) =>
      p.getAttribute("stroke")?.includes("sw-graph-line"),
    );
  expect(blue()).toHaveLength(1);
  expect(green()).toHaveLength(2);
  for (const stroke of green()) {
    const xs = [...stroke.getAttribute("d")!.matchAll(/[ML]([\d.-]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 0);
  }
  expect(within(container).getByText(/^6:00\sPM$/)).toBeDefined();
  rerender(graph([]));
  expect(blue()).toHaveLength(0);
  expect(green()).toHaveLength(2);
});

test("a continuous card window shows each exact Slack time when its opening is off-screen", async () => {
  const { container } = render(
    <div style={{ width: 360, height: 120, position: "relative" }}>
      <StationCardGraph
        data={{ ...data, runs: [{ start: at(-12), end: at(12) }] }}
        now={T0}
        timezone="UTC"
        locale="en-US"
      />
    </div>,
  );
  await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  for (const label of [/^6:00\sAM$/, /^6:00\sPM$/]) {
    expect(within(container).getByText(label).getAttribute("fill")).toContain("sw-go");
  }
});

test("a weak current card without a reversal keeps the yellow base curve", async () => {
  const { container } = render(
    <div style={{ width: 360, height: 120, position: "relative" }}>
      <StationCardGraph
        data={{
          ...data,
          timeline: data.timeline.map((p) => ({ ...p, speed: 0.2 })),
          events: [],
          runs: [],
        }}
        now={T0}
        timezone="UTC"
      />
    </div>,
  );
  await waitFor(() => expect(container.querySelector('path[stroke-width="2.5"]')).not.toBeNull());
  expect(container.querySelector('path[stroke-width="2.5"]')!.getAttribute("stroke")).toBe(
    "#f5c96b",
  );
});

test("tide card high and low times reuse the corresponding event colors", async () => {
  const extremes = [
    { time: at(-6), level: 3, high: true, low: false, label: "High" },
    { time: at(6), level: 0, high: false, low: true, label: "Low" },
  ];
  const { container } = render(
    <div style={{ width: 360, height: 120, position: "relative" }}>
      <StationCardGraph
        data={{
          kind: "tide",
          timeline: [
            { time: at(-12), level: 0 },
            { time: at(0), level: 2 },
            { time: at(12), level: 3 },
          ],
          extremes,
          units: "meters",
        }}
        now={T0}
        timezone="UTC"
        locale="en-US"
      />
    </div>,
  );
  await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  expect(
    within(container)
      .getByText(/^6:00\sAM$/)
      .getAttribute("fill"),
  ).toContain("sw-graph-high");
  expect(
    within(container)
      .getByText(/^6:00\sPM$/)
      .getAttribute("fill"),
  ).toContain("sw-graph-low");
});
