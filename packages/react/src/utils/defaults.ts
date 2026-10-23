import type { Units } from "../types.js";

const IMPERIAL_LOCALES = ["en-US", "en-LR", "my-MM"];

/**
 * Determine the default unit system from a locale string.
 * Falls back to detecting from `navigator.language` when no locale is provided.
 */
export function getDefaultUnits(locale?: string): Units {
  const lang = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  return IMPERIAL_LOCALES.includes(lang) ? "feet" : "meters";
}
