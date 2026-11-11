import { expect, test } from "vitest";
import { buildCatalog } from "../src/generate.js";
import { Catalog } from "../src/catalog.js";
import { executeTool, windowResults } from "../src/tools.js";
import { station, versions } from "./fixtures.js";
import { loadStations } from "@slackwater/database";
import { useStation } from "@slackwater/engine";

const start = "2026-11-10T08:00:00Z",
  end = "2026-11-11T08:00:00Z";
function catalog(
  records = [
    station(),
    station("test/gate", { kind: "current", current: { flood_direction: 45, ebb_direction: 235 } }),
  ],
) {
  const built = buildCatalog(records, versions);
  return new Catalog(built.index, async (id) => built.models.get(id));
}
test("tide results name datum, units, timezone and provenance", async () => {
  const result = await executeTool(catalog(), "get_tide_prediction", {
    station_id: "test/port",
    start,
    end,
    timeline: true,
    units: "feet",
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    datum: "MLLW",
    units: "feet",
    provenance: versions,
    station: { timezone: "America/Los_Angeles", attribution: "Test source" },
  });
  const value = result.structuredContent!;
  expect(value.events).toHaveLength(4);
  expect(value.timeline).toHaveLength(145);
  expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "null")).toEqual(
    value,
  );
});
test("current events are trimmed to explicit bounds and diagnostics keep full vectors", async () => {
  const result = await executeTool(catalog(), "get_current_prediction", {
    station_id: "test/gate",
    start: "2026-11-10T23:00:00-08:00",
    end: "2026-11-11T01:00:00-08:00",
    diagnostics: true,
  });
  expect(result.isError).not.toBe(true);
  const value = result.structuredContent!;
  expect(value.units).toBe("knots");
  for (const event of value.events as { time: string }[])
    expect(Date.parse(event.time)).toBeGreaterThanOrEqual(Date.parse("2026-11-11T07:00:00Z"));
  expect((value.timeline as { magnitude: number }[]).every((p) => p.magnitude >= 0)).toBe(true);
});
test("zero comfort threshold yields exact slack instants", async () => {
  const result = await executeTool(catalog(), "get_slack_windows", {
    station_id: "test/gate",
    start,
    end,
    threshold_kn: 0,
  });
  expect(result.isError).not.toBe(true);
  const windows = result.structuredContent!.windows as { start: string; end: string }[];
  expect(windows.length).toBeGreaterThan(0);
  expect(windows.every((w) => w.start === w.end)).toBe(true);
});
test.each([
  ["get_tide_prediction", { station_id: "test/port", start, end: start }],
  ["get_tide_prediction", { station_id: "test/port", start, end: "2026-12-01T00:00:00Z" }],
  ["get_tide_prediction", { station_id: "test/port", start: "2026-02-30T00:00:00Z", end }],
  ["get_tide_prediction", { station_id: "test/port", start, end, datum: "UNKNOWN" }],
  ["get_current_prediction", { station_id: "test/port", start, end }],
  ["get_station", { station_id: "missing" }],
  ["find_stations", { kind: "tide", query: " " }],
  ["get_slack_windows", { station_id: "test/gate", start, end, threshold_kn: -1 }],
  ["unknown_tool", {}],
] as const)("%s rejects invalid inputs with a stable error", async (name, args) => {
  const result = await executeTool(catalog(), name, args);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toHaveProperty("error.code");
});
test("unavailable station diagnostics never return model inputs", async () => {
  const c = catalog([
    station("test/nc", { license: { type: "NC", commercial_use: false, url: "" } }),
  ]);
  const result = await executeTool(c, "get_station", { station_id: "test/nc", diagnostics: true });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("harmonic_constituents");
});

test("full serialized UTF-8 output is bounded including the duplicated JSON fallback", async () => {
  const c = catalog([station("test/large", { name: "港".repeat(50000) })]);
  const result = await executeTool(c, "get_station", { station_id: "test/large" });
  expect(result).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "result_too_large" } },
  });
});

test("subordinate tide offsets use the engine's datum and reference credits", async () => {
  const ref = station("test/ref", { attribution: "Reference credit" });
  const sub = station("test/sub", {
    type: "subordinate",
    harmonic_constituents: [],
    offsets: {
      reference: ref.id,
      height: { type: "fixed", high: 1, low: 1 },
      time: { high: 60, low: 60 },
    },
  });
  const result = await executeTool(catalog([sub, ref]), "get_tide_prediction", {
    station_id: sub.id,
    start,
    end,
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent!.attribution).toEqual(["Test source", "Reference credit"]);
  const raw = useStation(ref).getExtremesPrediction({
    start: new Date(start),
    end: new Date(end),
  }).extremes;
  const events = result.structuredContent!.events as { time: string; level: number }[];
  expect(events[0].level).toBeCloseTo(raw[0].level + 1, 5);
  expect(Date.parse(events[0].time) - raw[0].time.getTime()).toBeCloseTo(3600000, -2);
});

test("Trial Island retains the non-reversing near-zero ebb and its reference identity", async () => {
  const db = await loadStations();
  const trial = db.byId("noaa/PCT1391")!,
    reference = db.byId("noaa/PUG1640")!;
  const result = await executeTool(catalog([trial, reference]), "get_current_prediction", {
    station_id: trial.id,
    start,
    end,
    diagnostics: true,
  });
  expect(result.isError).not.toBe(true);
  const events = result.structuredContent!.events as {
    kind: string;
    speed: number;
    time: string;
  }[];
  const lull = events.find((e) => e.kind === "maxEbb" && Math.abs(e.speed) < 0.05)!;
  expect(lull.speed).toBeCloseTo(-0.0397582, 5);
  expect(lull.time).toMatch(/^2026-11-10T22:37:/);
  expect(result.structuredContent!.station).toHaveProperty("reference", reference.id);
});

test("windows clip context, preserve zero times, and exclude non-reversing lulls", () => {
  const t = (h: number) => new Date(Date.parse(start) + h * 3600000);
  const points = [-2, 0, 2].map((speed, i) => ({ time: t(i), hour: i, speed }));
  const events = [{ time: t(1), speed: 0, kind: "slack" as const }];
  expect(windowResults(points, events, 1, { start: t(0.75), end: t(1.25) })).toEqual([
    {
      start: t(0.75),
      end: t(1.25),
      clipped_start: true,
      clipped_end: true,
      series_limited: false,
      slack_times: [t(1)],
    },
  ]);
  expect(windowResults(points, events, 10, { start: t(0), end: t(2) })[0].series_limited).toBe(
    true,
  );
  expect(windowResults(points, events, 1, { start: t(4), end: t(5) })).toEqual([]);
  expect(
    windowResults(
      points.map((p) => ({ ...p, speed: -Math.abs(p.speed) - 0.04 })),
      [],
      1,
      { start: t(0), end: t(2) },
    ),
  ).toEqual([]);
});

test("vector magnitude is independent from the signed major-axis samples", async () => {
  const gate = station("test/vector", {
    kind: "current",
    current: {
      azimuth: 0,
      minor_mean_flow: 2,
      minor_constituents: [{ name: "M2", amplitude: 0, phase: 0 }],
    },
  });
  const result = await executeTool(catalog([gate]), "get_current_prediction", {
    station_id: gate.id,
    start,
    end,
    diagnostics: true,
  });
  expect(result.isError).not.toBe(true);
  const points = result.structuredContent!.timeline as { magnitude: number; speed: number }[];
  expect(points.every((p) => p.magnitude > Math.abs(p.speed))).toBe(true);
});

test("model failures return safe errors without a stack or internal message", async () => {
  const broken = station("test/broken", { datums: { MLLW: 0 } });
  const result = await executeTool(catalog([broken]), "get_tide_prediction", {
    station_id: broken.id,
    start,
    end,
  });
  expect(result).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "prediction_error" } },
  });
  expect(JSON.stringify(result)).not.toContain("missing MSL");
});

test("missing-reference station inspection still returns its unavailability reason", async () => {
  const gate = station("test/missing-reference", {
    kind: "current",
    harmonic_constituents: [],
    current: { offsets: { reference: "test/absent" } },
  });
  const result = await executeTool(catalog([gate]), "get_station", { station_id: gate.id });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent!.station).toMatchObject({
    predictions: false,
    unavailable: { code: "reference_unavailable" },
  });
});

test("unspecified datum and absent current bearings stay unknown in results", async () => {
  const c = catalog([
    station("test/unspecified", { chart_datum: undefined, datums: {} }),
    station("test/no-bearings", { kind: "current" }),
  ]);
  const tide = await executeTool(c, "get_tide_prediction", {
    station_id: "test/unspecified",
    start,
    end,
  });
  expect(tide.structuredContent!.datum).toBeNull();
  const current = await executeTool(c, "get_current_prediction", {
    station_id: "test/no-bearings",
    start,
    end,
    diagnostics: true,
  });
  expect(current.isError).not.toBe(true);
  expect(current.structuredContent!.diagnostics).toEqual({ offsets: null });
  const inspect = await executeTool(c, "get_station", {
    station_id: "test/no-bearings",
    diagnostics: true,
  });
  expect(inspect.structuredContent).toHaveProperty("diagnostics.harmonic_constituents");
});
