import { describe, test, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { SlackwaterProvider, useSlackwaterConfig, useUpdateConfig } from "../src/provider.js";
import type { ReactNode } from "react";

beforeEach(() => {
  localStorage.removeItem("slackwater-settings");
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SlackwaterProvider baseUrl="https://api.example.com" units="feet">
      {children}
    </SlackwaterProvider>
  );
}

describe("SlackwaterProvider", () => {
  test("provides config to consumers", () => {
    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper });

    expect(result.current).toEqual({
      baseUrl: "https://api.example.com",
      units: "feet",
      locale: "en-US",
    });
  });

  test("defaults units based on locale", () => {
    const minimalWrapper = ({ children }: { children: ReactNode }) => (
      <SlackwaterProvider baseUrl="https://api.example.com">{children}</SlackwaterProvider>
    );

    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper: minimalWrapper });

    // en-US defaults to feet; non-US locales default to meters
    expect(result.current.units).toBe("feet");
  });

  test("defaults timezone to undefined", () => {
    const minimalWrapper = ({ children }: { children: ReactNode }) => (
      <SlackwaterProvider baseUrl="https://api.example.com">{children}</SlackwaterProvider>
    );

    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper: minimalWrapper });
    expect(result.current.timezone).toBeUndefined();
  });

  test("applies initial timezone prop", () => {
    const tzWrapper = ({ children }: { children: ReactNode }) => (
      <SlackwaterProvider baseUrl="https://api.example.com" timezone="America/Los_Angeles">
        {children}
      </SlackwaterProvider>
    );

    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper: tzWrapper });
    expect(result.current.timezone).toBe("America/Los_Angeles");
  });

  test("throws when useSlackwaterConfig is used outside provider", () => {
    expect(() => {
      renderHook(() => useSlackwaterConfig());
    }).toThrow("useSlackwaterConfig must be used within a <SlackwaterProvider>");
  });

  test("throws when useUpdateConfig is used outside provider", () => {
    expect(() => {
      renderHook(() => useUpdateConfig());
    }).toThrow("useUpdateConfig must be used within a <SlackwaterProvider>");
  });
});

describe("useUpdateConfig", () => {
  test("updates units", () => {
    const { result } = renderHook(
      () => ({ config: useSlackwaterConfig(), update: useUpdateConfig() }),
      {
        wrapper,
      },
    );

    expect(result.current.config.units).toBe("feet");

    act(() => {
      result.current.update({ units: "meters" });
    });

    expect(result.current.config.units).toBe("meters");
  });

  test("updates timezone", () => {
    const { result } = renderHook(
      () => ({ config: useSlackwaterConfig(), update: useUpdateConfig() }),
      {
        wrapper,
      },
    );

    act(() => {
      result.current.update({ timezone: "UTC" });
    });

    expect(result.current.config.timezone).toBe("UTC");
  });

  test("updates locale", () => {
    const { result } = renderHook(
      () => ({ config: useSlackwaterConfig(), update: useUpdateConfig() }),
      {
        wrapper,
      },
    );

    act(() => {
      result.current.update({ locale: "fr-FR" });
    });

    expect(result.current.config.locale).toBe("fr-FR");
  });

  test("persists settings to localStorage", () => {
    const { result } = renderHook(
      () => ({ config: useSlackwaterConfig(), update: useUpdateConfig() }),
      {
        wrapper,
      },
    );

    act(() => {
      result.current.update({ units: "meters" });
    });

    const stored = JSON.parse(localStorage.getItem("slackwater-settings") ?? "{}");
    expect(stored.units).toBe("meters");
  });

  test("ignores and drops a datum an older release saved", async () => {
    localStorage.setItem("slackwater-settings", JSON.stringify({ datum: "MSL", units: "meters" }));
    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper });

    await waitFor(() => expect(result.current.units).toBe("meters"));
    expect(result.current).not.toHaveProperty("datum");
    expect(JSON.parse(localStorage.getItem("slackwater-settings")!)).toEqual({ units: "meters" });
  });

  test("leaves stored settings alone when they have no datum", async () => {
    localStorage.setItem("slackwater-settings", '{"units":"meters"}');
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper });

    await waitFor(() => expect(result.current.units).toBe("meters"));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  test("falls back to the props when stored settings aren't JSON", async () => {
    localStorage.setItem("slackwater-settings", "{");
    const { result } = renderHook(() => useSlackwaterConfig(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.units).toBe("feet");
  });
});
