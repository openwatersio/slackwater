import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  fetchStation,
  fetchStations,
  fetchExtremes,
  fetchTimeline,
  fetchStationExtremes,
  fetchStationTimeline,
  fetchCurrentStation,
  fetchCurrentStations,
  fetchCurrentStationEvents,
  fetchCurrentStationTimeline,
} from "../src/client.js";

const BASE_URL = "https://api.example.com";
const BASE_URL_WITH_PATH = "https://api.example.com/some/deep/path";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
    }),
  );
}

describe("base URL with path", () => {
  test("preserves base URL path for station requests", async () => {
    mockFetch({ id: "noaa/8722588", name: "Test Station" });

    await fetchStation(BASE_URL_WITH_PATH, "noaa/8722588");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/some/deep/path/tides/stations/noaa/8722588",
    );
  });

  test("preserves base URL path for extremes requests", async () => {
    mockFetch({ extremes: [] });

    await fetchExtremes(BASE_URL_WITH_PATH, { latitude: 26.7, longitude: -80.05 });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(url).pathname).toBe("/some/deep/path/tides/extremes");
  });

  test("preserves base URL path with trailing slash", async () => {
    mockFetch({ timeline: [] });

    await fetchTimeline(BASE_URL_WITH_PATH + "/", { latitude: 26.7, longitude: -80.05 });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(url).pathname).toBe("/some/deep/path/tides/timeline");
  });
});

describe("fetchStation", () => {
  test("builds correct URL from composite id", async () => {
    mockFetch({ id: "noaa/8722588", name: "Test Station" });

    await fetchStation(BASE_URL, "noaa/8722588");

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/tides/stations/noaa/8722588");
  });

  test("throws on invalid id format", () => {
    expect(() => fetchStation(BASE_URL, "invalid")).toThrow('Invalid station ID: "invalid"');
  });

  test("throws on HTTP error with message from body", async () => {
    mockFetch({ message: "Station not found" }, 404);

    await expect(fetchStation(BASE_URL, "noaa/999999")).rejects.toThrow("Station not found");
  });

  test("falls back to the status when the error body has no message or isn't JSON", async () => {
    mockFetch({}, 500);
    await expect(fetchStation(BASE_URL, "noaa/1")).rejects.toThrow("Request failed: 500");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      }),
    );
    await expect(fetchStation(BASE_URL, "noaa/1")).rejects.toThrow("Bad Gateway");
  });
});

describe("fetchStations", () => {
  test("search by query", async () => {
    mockFetch([]);

    await fetchStations(BASE_URL, { query: "palm beach" });

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/tides/stations?query=palm+beach");
  });

  test("proximity search", async () => {
    mockFetch([]);

    await fetchStations(BASE_URL, { latitude: 26.7, longitude: -80.05, maxResults: 5 });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("latitude")).toBe("26.7");
    expect(parsed.searchParams.get("longitude")).toBe("-80.05");
    expect(parsed.searchParams.get("maxResults")).toBe("5");
  });

  test("omits undefined params", async () => {
    mockFetch([]);

    await fetchStations(BASE_URL, {});

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/tides/stations");
  });

  test("marks each station as a tide station", async () => {
    mockFetch([{ id: "noaa/8722588" }]);

    expect(await fetchStations(BASE_URL, { query: "palm" })).toEqual([
      { id: "noaa/8722588", kind: "tide" },
    ]);
  });
});

describe("fetchExtremes", () => {
  test("includes all params in URL", async () => {
    mockFetch({ extremes: [{ time: "2025-01-01T06:00:00Z", level: 1, high: true }] });

    const res = await fetchExtremes(BASE_URL, {
      latitude: 26.7,
      longitude: -80.05,
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-02T00:00:00Z",
      datum: "MLLW",
      units: "feet",
    });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/tides/extremes");
    expect(parsed.searchParams.get("latitude")).toBe("26.7");
    expect(parsed.searchParams.get("units")).toBe("feet");
    expect(res.extremes[0].time).toEqual(new Date("2025-01-01T06:00:00Z"));
  });
});

describe("fetchTimeline", () => {
  test("builds correct URL", async () => {
    mockFetch({ timeline: [{ time: "2025-01-01T00:00:00Z", level: 1 }] });

    const res = await fetchTimeline(BASE_URL, { latitude: 26.7, longitude: -80.05 });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(url).pathname).toBe("/tides/timeline");
    expect(res.timeline[0].time).toEqual(new Date("2025-01-01T00:00:00Z"));
  });
});

describe("fetchStationExtremes", () => {
  test("uses station path and strips id from query params", async () => {
    mockFetch({ extremes: [] });

    await fetchStationExtremes(BASE_URL, {
      id: "noaa/8722588",
      datum: "MSL",
    });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/tides/stations/noaa/8722588/extremes");
    expect(parsed.searchParams.get("datum")).toBe("MSL");
    expect(parsed.searchParams.has("id")).toBe(false);
  });
});

describe("fetchStationTimeline", () => {
  test("uses station path", async () => {
    mockFetch({ timeline: [] });

    await fetchStationTimeline(BASE_URL, { id: "noaa/8722588" });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(url).pathname).toBe("/tides/stations/noaa/8722588/timeline");
  });
});

describe("current stations", () => {
  test("fetchCurrentStations lists current stations, each marked as one", async () => {
    mockFetch([{ id: "noaa/PUG1701", predictions: true }]);

    const res = await fetchCurrentStations(BASE_URL, { latitude: 48.4, longitude: -122.6 });

    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe("/currents/stations");
    expect(url.searchParams.get("latitude")).toBe("48.4");
    expect(res).toEqual([{ id: "noaa/PUG1701", predictions: true, kind: "current" }]);
  });

  test("fetchCurrentStation keeps a bin or bare curated id in the path", async () => {
    mockFetch({ id: "noaa/EPT0003" });

    await fetchCurrentStation(BASE_URL, "noaa/EPT0003@11");
    await fetchCurrentStation(BASE_URL, "chs-active-pass");

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => new URL(c[0]).pathname);
    expect(calls).toEqual([
      "/currents/stations/noaa/EPT0003@11",
      "/currents/stations/chs-active-pass",
    ]);
  });

  test("fetchCurrentStationEvents parses event times and sends the range", async () => {
    mockFetch({ events: [{ time: "2026-10-10T03:00:00Z", speed: 3, kind: "maxFlood" }] });

    const res = await fetchCurrentStationEvents(BASE_URL, {
      id: "noaa/PUG1701",
      start: "2026-10-10T00:00:00Z",
    });

    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe("/currents/stations/noaa/PUG1701/events");
    expect(url.searchParams.get("start")).toBe("2026-10-10T00:00:00Z");
    expect(url.searchParams.has("id")).toBe(false);
    expect(res.events[0].time).toEqual(new Date("2026-10-10T03:00:00Z"));
  });

  test("fetchCurrentStationTimeline parses timeline times", async () => {
    mockFetch({ timeline: [{ time: "2026-10-10T00:00:00Z", speed: -1 }] });

    const res = await fetchCurrentStationTimeline(BASE_URL, { id: "noaa/PUG1701" });

    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe("/currents/stations/noaa/PUG1701/timeline");
    expect(res.timeline[0].time).toEqual(new Date("2026-10-10T00:00:00Z"));
  });
});
