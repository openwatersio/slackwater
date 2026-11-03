import { vi } from "vitest";
import type { SlackwaterDataSource, TidePredictionParams } from "../src/data-source.js";
import type { CurrentStationInfo, Station } from "../src/types.js";

export function localSource(cacheKey = "local:v1", name = "Local Harbor") {
  const station: Station = {
    id: "local/harbor",
    name,
    kind: "tide",
    latitude: 48,
    longitude: -123,
    country: "US",
    continent: "Americas",
    timezone: "UTC",
    type: "reference",
    source: { id: "local", name: "Local model", url: "https://example.com" },
    license: { type: "CC0", commercial_use: true, url: "https://example.com/license" },
    attribution: "Local model credit",
    datums: { MLLW: 0 },
    defaultDatum: "MLLW",
    harmonic_constituents: [],
    predictions: true,
  };
  const current: CurrentStationInfo = {
    ...station,
    id: "local/channel",
    kind: "current",
    bins: [{ id: "local/channel" }],
    predictions: true,
    license: { ...station.license, url: "https://example.com/license" },
    source: { ...station.source, published_harmonics: true },
    current: { flood_direction: 90, ebb_direction: 270 },
  };
  function span(params: { start?: string; end?: string }) {
    const start = params.start ? Date.parse(params.start) : Date.now() - 86_400_000;
    const end = params.end ? Date.parse(params.end) : start + 3 * 86_400_000;
    return { start, end };
  }
  const source = {
    cacheKey,
    getStation: vi.fn<SlackwaterDataSource["getStation"]>(async (id) => ({ ...station, id })),
    getStations: vi.fn<SlackwaterDataSource["getStations"]>(async () => []),
    getExtremes: vi.fn<SlackwaterDataSource["getExtremes"]>(async (params) => {
      const { start, end } = span(params);
      return {
        station,
        units: params.units ?? "feet",
        datum: "MLLW",
        distance: 0,
        extremes: Array.from({ length: Math.floor((end - start) / 21_600_000) + 1 }, (_, i) => ({
          time: new Date(start + i * 21_600_000),
          level: i % 2 ? 1 : 3,
          high: i % 2 === 0,
          low: i % 2 !== 0,
          label: i % 2 ? "Low" : "High",
        })),
      };
    }),
    getTimeline: vi.fn<SlackwaterDataSource["getTimeline"]>(
      async (params: TidePredictionParams) => {
        const { start, end } = span(params);
        return {
          station,
          units: params.units ?? "feet",
          datum: "MLLW",
          distance: 0,
          timeline: Array.from({ length: Math.floor((end - start) / 600_000) + 1 }, (_, i) => ({
            time: new Date(start + i * 600_000),
            level: 2 + Math.cos((i * Math.PI) / 36),
          })),
        };
      },
    ),
    getCurrentStation: vi.fn<SlackwaterDataSource["getCurrentStation"]>(async (id) => ({
      ...current,
      id,
    })),
    getCurrentStations: vi.fn<SlackwaterDataSource["getCurrentStations"]>(async () => []),
    getCurrentEvents: vi.fn<SlackwaterDataSource["getCurrentEvents"]>(async (params) => {
      const { start, end } = span(params);
      return {
        station: current,
        units: "knots",
        events: Array.from({ length: Math.floor((end - start) / 10_800_000) + 1 }, (_, i) => ({
          time: new Date(start + i * 10_800_000),
          speed: i % 2 ? 0 : i % 4 === 0 ? 1 : -1,
          kind: i % 2 ? "slack" : i % 4 === 0 ? "maxFlood" : "maxEbb",
          ...(i % 2 ? {} : { direction: i % 4 === 0 ? 90 : 270 }),
        })),
      };
    }),
    getCurrentTimeline: vi.fn<SlackwaterDataSource["getCurrentTimeline"]>(async (params) => {
      const { start, end } = span(params);
      return {
        station: current,
        units: "knots",
        timeline: Array.from({ length: Math.floor((end - start) / 600_000) + 1 }, (_, i) => ({
          time: new Date(start + i * 600_000),
          speed: Math.cos((i * Math.PI) / 36),
        })),
      };
    }),
  } satisfies SlackwaterDataSource;
  return source;
}
