import type { Units } from "../types.js";

/** Format a water level value with unit suffix. */
export function formatLevel(level: number, units: Units): string {
  const precision = units === "feet" ? 1 : 2;
  const suffix = units === "feet" ? "ft" : "m";
  return `${level.toFixed(precision)} ${suffix}`;
}

/** Format a time in the station's timezone. */
export function formatTime(time: Date, timezone: string, locale?: string): string {
  return time.toLocaleTimeString(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format a date in the station's timezone. */
export function formatDate(time: Date, timezone: string, locale?: string): string {
  return time.toLocaleDateString(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Format a distance in meters as a human-readable string. */
export function formatDistance(meters: number, units: Units): string {
  if (units === "feet") {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.2808399)} ft`;
    return miles >= 10 ? `${Math.round(miles)} mi` : `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}
