import type { Station } from "@slackwater/database";
export const versions = {
  server: "1.0.0-beta.0",
  engine: "test-engine",
  database: "test-database",
};
export function station(id = "test/port", changes: Partial<Station> = {}): Station {
  return {
    id,
    name: "Port",
    kind: "tide",
    continent: "North America",
    country: "United States",
    country_code: "US",
    timezone: "America/Los_Angeles",
    type: "reference",
    latitude: 48,
    longitude: -123,
    source: {
      name: "Test",
      id: id.split("/").at(-1)!,
      published_harmonics: true,
      url: "https://example.com",
    },
    license: { type: "Public domain", commercial_use: true, url: "https://example.com/license" },
    attribution: "Test source",
    datums: { MSL: 0, MLLW: -1 },
    chart_datum: "MLLW",
    harmonic_constituents: [{ name: "M2", amplitude: 1, phase: 0 }],
    ...changes,
  };
}
