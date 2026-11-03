import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { useState } from "react";
import { SlackwaterProvider, useSlackwaterConfig } from "../../src/provider.js";
import { TideStation } from "../../src/components/TideStation.js";
import { CurrentStation } from "../../src/components/CurrentStation.js";
import { prefetchTideStation } from "../../src/prefetch.js";
import { createApiDataSource } from "../../src/data-source.js";
import { currentTimelineQuery, useCurrentTimeline } from "../../src/hooks/use-current-station.js";
import { useStation } from "../../src/hooks/use-station.js";
import type { Station } from "../../src/types.js";
import { localSource } from "../local-source.js";

afterEach(() => vi.restoreAllMocks());
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

test("local tide and current pages render without an HTTP API", async () => {
  const source = localSource();
  const fetch = vi.spyOn(window, "fetch");
  render(
    <SlackwaterProvider
      baseUrl="https://unused.example"
      dataSource={source}
      queryClient={client()}
      units="feet"
    >
      <TideStation id="local/harbor" />
      <CurrentStation id="local/channel" />
    </SlackwaterProvider>,
  );
  await screen.findByRole("slider", { name: "Tide timeline" }, { timeout: 10000 });
  await screen.findByRole("slider", { name: "Current timeline" }, { timeout: 10000 });
  expect(screen.getAllByRole("heading", { name: "Local Harbor" })).toHaveLength(2);
  expect(source.getStation).toHaveBeenCalledWith("local/harbor");
  expect(source.getCurrentStation).toHaveBeenCalledWith("local/channel");
  expect(source.getStations).toHaveBeenCalled();
  expect(source.getCurrentStations).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("providers sharing a query client keep the same station id isolated", async () => {
  const queryClient = client();
  render(
    <>
      <SlackwaterProvider dataSource={localSource("a", "Source A")} queryClient={queryClient}>
        <TideStation id="local/harbor" />
      </SlackwaterProvider>
      <SlackwaterProvider dataSource={localSource("b", "Source B")} queryClient={queryClient}>
        <TideStation id="local/harbor" />
      </SlackwaterProvider>
    </>,
  );
  await screen.findByRole("heading", { name: "Source A" });
  await screen.findByRole("heading", { name: "Source B" });
});

test("a late response from an old source cannot replace the new source", async () => {
  const a = localSource("a", "Source A");
  const b = localSource("b", "Source B");
  let resolve!: (station: Station) => void;
  const record = await a.getStation("local/harbor");
  a.getStation.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  function Reading() {
    const result = useStation("local/harbor");
    return <p>{result.data?.name ?? "Loading source"}</p>;
  }
  function Host() {
    const [source, setSource] = useState(a);
    return (
      <>
        <button onClick={() => setSource(b)}>Switch source</button>
        <SlackwaterProvider dataSource={source} queryClient={queryClient}>
          <Reading />
        </SlackwaterProvider>
      </>
    );
  }
  const queryClient = client();
  render(<Host />);
  await waitFor(() => expect(a.getStation).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Switch source" }));
  await screen.findByText("Source B");
  await act(async () => resolve(record));
  expect(screen.queryByText("Source A")).toBeNull();
  expect(screen.getByText("Source B")).toBeDefined();
});

test("a source change clears previous prediction placeholders while the new source is pending", async () => {
  const a = localSource("a", "Source A");
  const b = localSource("b", "Source B");
  const range = { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" };
  const record = await b.getCurrentTimeline({ id: "local/channel", ...range });
  let resolve!: (value: typeof record) => void;
  b.getCurrentTimeline.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  function Reading() {
    const result = useCurrentTimeline("local/channel", range);
    return <p>{result.data?.station.name ?? "Loading source"}</p>;
  }
  const queryClient = client();
  const view = (source: ReturnType<typeof localSource>) => (
    <SlackwaterProvider dataSource={source} queryClient={queryClient}>
      <Reading />
    </SlackwaterProvider>
  );
  const { rerender } = render(view(a));
  await screen.findByText("Source A");
  rerender(view(b));
  expect(screen.queryByText("Source A")).toBeNull();
  expect(screen.getByText("Loading source")).toBeDefined();
  await act(async () => resolve(record));
  await screen.findByText("Source B");
});

test("local prefetch and hydration use the same source keys as the page", async () => {
  const source = localSource();
  const server = client();
  await prefetchTideStation(server, source, "local/harbor", { now: Date.now(), units: "feet" });
  const before = source.getTimeline.mock.calls.length + source.getExtremes.mock.calls.length;
  const browser = client();
  hydrate(browser, dehydrate(server));
  const fetch = vi.spyOn(window, "fetch");
  render(
    <SlackwaterProvider dataSource={source} queryClient={browser} units="feet">
      <TideStation id="local/harbor" />
    </SlackwaterProvider>,
  );
  await screen.findByRole("slider", { name: "Tide timeline" });
  expect(source.getTimeline.mock.calls.length + source.getExtremes.mock.calls.length).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});

test("a source's availability flag prevents prediction calls", async () => {
  const source = localSource();
  const record = await source.getStation("local/harbor");
  source.getStation.mockResolvedValue({
    ...record,
    predictions: false,
    unavailable: "Browser-only predictions",
  });
  render(
    <SlackwaterProvider dataSource={source} queryClient={client()}>
      <TideStation id="local/harbor" />
    </SlackwaterProvider>,
  );
  await screen.findByText("Browser-only predictions");
  expect(source.getTimeline).not.toHaveBeenCalled();
  expect(source.getExtremes).not.toHaveBeenCalled();
});

test("a source must have a stable nonempty cache key", () => {
  const source = { ...localSource(), cacheKey: " " };
  expect(() =>
    render(<SlackwaterProvider dataSource={source}>invalid</SlackwaterProvider>),
  ).toThrow(/cacheKey/);
});

test("internal and public API addresses can hydrate under an explicit shared identity", async () => {
  const source = localSource();
  const range = { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" };
  const response = await source.getCurrentTimeline({ id: "local/channel", ...range });
  const fetch = vi.spyOn(window, "fetch").mockResolvedValue(Response.json(response));
  const internal = createApiDataSource("https://internal.example", { cacheKey: "public:v1" });
  const external = createApiDataSource("https://public.example", { cacheKey: "public:v1" });
  const server = client();
  await server.prefetchQuery(currentTimelineQuery(internal, "local/channel", range));
  const browser = client();
  hydrate(browser, dehydrate(server));
  function Reading() {
    const result = useCurrentTimeline("local/channel", range);
    return <p>{result.data?.station.name ?? "Loading source"}</p>;
  }
  render(
    <SlackwaterProvider dataSource={external} queryClient={browser}>
      <Reading />
    </SlackwaterProvider>,
  );
  await screen.findByText("Local Harbor");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain("https://internal.example/");
});

test("invalid HTTP configuration stays a query error rather than crashing the provider", async () => {
  render(
    <SlackwaterProvider baseUrl="" queryClient={client()}>
      <TideStation id="noaa/9447130" />
    </SlackwaterProvider>,
  );
  await screen.findByText(/Invalid.*URL/);
});

test("an unavailable injected source is not predicted during server prefetch", async () => {
  const source = localSource();
  const record = await source.getStation("local/harbor");
  source.getStation.mockResolvedValue({
    ...record,
    predictions: false,
    unavailable: "Browser only",
  });
  await prefetchTideStation(client(), source, "local/harbor");
  expect(source.getTimeline).not.toHaveBeenCalled();
  expect(source.getExtremes).not.toHaveBeenCalled();
});

test("invalid HTTP configuration leaves server prefetch in an error state", async () => {
  const queryClient = client();
  await expect(prefetchTideStation(queryClient, "", "noaa/9447130")).resolves.toBeUndefined();
  expect(queryClient.getQueryCache().getAll()[0].state.status).toBe("error");
});

test("an injected source does not expose the ignored base URL as active configuration", () => {
  const source = localSource();
  const { result } = renderHook(() => useSlackwaterConfig(), {
    wrapper: ({ children }) => (
      <SlackwaterProvider baseUrl="https://ignored.example" dataSource={source}>
        {children}
      </SlackwaterProvider>
    ),
  });
  expect(result.current.dataSource).toBe(source);
  expect(result.current.baseUrl).toBeUndefined();
});
