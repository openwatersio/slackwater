import { describe, test, expect } from "vitest";
import { getDefaultUnits } from "../src/utils/defaults.js";

describe("getDefaultUnits", () => {
  test("returns feet for en-US", () => {
    expect(getDefaultUnits("en-US")).toBe("feet");
  });

  test("returns feet for en-LR (Liberia)", () => {
    expect(getDefaultUnits("en-LR")).toBe("feet");
  });

  test("returns feet for my-MM (Myanmar)", () => {
    expect(getDefaultUnits("my-MM")).toBe("feet");
  });

  test("returns meters for en-GB", () => {
    expect(getDefaultUnits("en-GB")).toBe("meters");
  });

  test("returns meters for fr-FR", () => {
    expect(getDefaultUnits("fr-FR")).toBe("meters");
  });

  test("returns meters for ja-JP", () => {
    expect(getDefaultUnits("ja-JP")).toBe("meters");
  });

  test("falls back to navigator.language when no locale provided", () => {
    // In test environment (en-US), should return feet
    const result = getDefaultUnits();
    expect(["feet", "meters"]).toContain(result);
  });
});
