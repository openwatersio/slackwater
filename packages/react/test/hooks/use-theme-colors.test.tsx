import { describe, test, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThemeColors } from "../../src/hooks/use-theme-colors.js";

const VARS = ["--sw-steel", "--sw-paper", "--sw-map-ink"];

afterEach(() => {
  for (const name of VARS) {
    document.documentElement.style.removeProperty(name);
  }
});

describe("useThemeColors", () => {
  test("resolves the map colors from the theme", () => {
    const { result } = renderHook(() => useThemeColors());

    expect(result.current).toEqual({
      steel: "rgb(88, 136, 168)",
      paper: "rgb(252, 252, 252)",
      mapInk: "rgb(21, 34, 86)",
      mapLabel: "rgb(255, 255, 255)",
    });
  });

  test("follows an override, including one that refers to another variable", () => {
    document.documentElement.style.setProperty("--sw-paper", "#ff0000");
    document.documentElement.style.setProperty("--sw-steel", "var(--sw-paper)");

    const { result } = renderHook(() => useThemeColors());

    expect(result.current.paper).toBe("rgb(255, 0, 0)");
    expect(result.current.steel).toBe("rgb(255, 0, 0)");
  });

  test("falls back when a variable is unset", () => {
    document.documentElement.style.setProperty("--sw-map-ink", "initial");

    const { result } = renderHook(() => useThemeColors());

    expect(result.current.mapInk).toBe("rgb(21, 34, 86)");
  });
});
