import { describe, test, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useCurrentEvents,
  useCurrentStation,
  useCurrentTimeline,
} from "../../src/hooks/use-current-station.js";
import { createTestWrapper } from "../helpers.js";

const ID = "noaa/PUG1701";
const range = { start: "2026-10-10T00:00:00Z", end: "2026-10-11T00:00:00Z" };

describe("useCurrentStation", () => {
  test("fetches a current station", async () => {
    const { result } = renderHook(() => useCurrentStation(ID), { wrapper: createTestWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 10000 });
    expect(result.current.data!.kind).toBe("current");
    expect(result.current.data!.predictions).toBe(true);
  });
});

describe("useCurrentEvents and useCurrentTimeline", () => {
  test("fetch predictions for a range", async () => {
    const { result } = renderHook(
      () => ({ events: useCurrentEvents(ID, range), timeline: useCurrentTimeline(ID, range) }),
      { wrapper: createTestWrapper() },
    );

    await waitFor(
      () => {
        expect(result.current.events.isSuccess).toBe(true);
        expect(result.current.timeline.isSuccess).toBe(true);
      },
      { timeout: 10000 },
    );
    expect(result.current.events.data!.events[0].time).toBeInstanceOf(Date);
    expect(result.current.timeline.data!.timeline.length).toBeGreaterThan(0);
    // A fixed window's predictions never go stale, so the strip keeps its data.
    expect(result.current.events.isStale).toBe(false);
    expect(result.current.timeline.isStale).toBe(false);
  });

  test("wait for a range", () => {
    const { result } = renderHook(
      () => ({
        events: useCurrentEvents(ID, undefined),
        timeline: useCurrentTimeline(ID, undefined),
      }),
      { wrapper: createTestWrapper() },
    );

    expect(result.current.events.fetchStatus).toBe("idle");
    expect(result.current.timeline.fetchStatus).toBe("idle");
  });
});
