import { findStation } from "../src/index.js";
import { describe, it, expect } from "vitest";

/**
 * Snapshot tests for a curated sample of stations covering all tidal regimes,
 * amplitude ranges, data sources, and geographies. These catch regressions
 * when model changes (constituents, node corrections, algorithm) affect
 * real-world predictions.
 *
 * Update snapshots with: npx vitest run packages/slackwater/test/snapshots.test.ts --update
 */

const STATIONS: [string, Date?, Date?][] = [
  // Eastport, ME — semidiurnal, large range
  ["noaa/8410140"],
  // San Francisco — mixed semidiurnal
  ["noaa/9414290"],
  // Cabo San Lucas — mixed semidiurnal
  ["ticon/cabo_san_lucas-034-mex-uhslc_fd"],
  // Honolulu — mixed semidiurnal, Pacific
  ["noaa/1612340"],
  // Vaca Key, FL — mixed diurnal, Gulf
  ["noaa/8723970"],
  // Jakarta — diurnal, Southeast Asia
  ["noaa/6835001"],
  // White City, FL — diurnal, very high form number
  ["noaa/8728853"],
  // The Battery, NYC — US East Coast
  ["noaa/8518750"],
  // Sydney — Southern hemisphere
  ["ticon/sydney_fort_denison-60370-aus-bom"],
  // Hong Kong — China Sea
  ["ticon/hong_kong-329-hkg-uhslc_fd"],
  // Buenos Aires — South America
  ["ticon/buenos_aires-285a-arg-uhslc_rq"],
  // Galveston, TX — US Gulf Coast
  ["noaa/8771450"],
  // Christiansted, USVI — Caribbean
  ["noaa/9751364"],
  // Sitka, AK — high latitude
  ["noaa/9451600"],
  // Nonopapa, Niihau Is. — subordinate station
  ["noaa/1610367"],
  // Seattle, WA — Pacific Northwest
  ["noaa/9447130"],
  // Vancouver — Pacific Canada
  ["ticon/vancouver_bc-7735-can-meds"],
  // Port Ellen, Scotland
  [
    "ticon/port_ellen_islay-isl-gbr-bodc",
    new Date("2025-03-02T00:00:00Z"),
    new Date("2025-03-04T00:00:00Z"),
  ],
  // CRMS5858, Louisiana — US Gulf Coast
  ["ticon/crms5858-crms5858-usa-crms"],
  // Bournemouth, UK — double high water ((M4+MS4)/M2 = 0.75, Doodson criterion met)
  ["ticon/bournemouth-bou-gbr-bodc"],
];

const defaultStart = new Date("2025-01-15T00:00:00Z");
const defaultEnd = new Date("2025-01-18T00:00:00Z");

describe("prediction snapshots", () => {
  STATIONS.forEach(([id, start = defaultStart, end = defaultEnd]) => {
    it(id, async () => {
      const station = await findStation(id);
      const { extremes, datum } = station.getExtremesPrediction({ start, end });

      expect({
        name: station.name,
        datum,
        extremes: extremes.map((e) => ({
          time: new Date(Math.round(e.time.getTime() / 1000) * 1000).toISOString(),
          level: Math.round(e.level * 1000) / 1000,
          high: e.high,
        })),
      }).toMatchSnapshot();
    });
  });
});
