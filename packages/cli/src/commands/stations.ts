import { Command, Option } from "commander";
import { search, stations as allStations, near, type Station } from "@slackwater/database";
import getFormat, { type Formats, type StationResult } from "../formatters/index.js";
import { resolveCoordinates } from "../lib/station.js";
import { stationLimit } from "../lib/options.js";

// The database also carries current stations, which `currents stations` lists.
const tideOnly = (station: Station) => station.kind === "tide";

export default new Command("stations")
  .description("Search for tide prediction stations")
  .argument("[query]", "search by name, region, country, or ID")
  .option("-n, --near <lat,lon>", "find stations near coordinates")
  .option("--ip", "use IP geolocation to find nearest stations")
  .option("-l, --limit <n>", "maximum number of results", "10")
  .option("-a, --all", "show all matching stations (no limit)")
  .addOption(
    new Option("-f, --format <format>", "output format").choices(["text", "json"]).default("text"),
  )
  .action(async (query: string | undefined, opts) => {
    const limit = stationLimit(opts);
    let results: StationResult[];

    if (opts.near || opts.ip) {
      const coords = await resolveCoordinates(opts);
      let filter: (s: Station) => boolean = tideOnly;
      if (query) {
        const matches = new Set(
          search(query, { filter: tideOnly, maxResults: Infinity }).map((s) => s.id),
        );
        filter = (s) => matches.has(s.id);
      }
      const nearby = near({
        ...coords,
        maxResults: limit,
        filter,
      });
      results = nearby.map(([station, distance]) => ({ ...station, distance }));
    } else if (query) {
      results = search(query, {
        maxResults: limit,
        filter: tideOnly,
      });
    } else {
      const tideStations = allStations.filter(tideOnly);
      results = tideStations.slice(0, limit);
    }

    if (!results.length) {
      throw new Error("No stations found");
    }

    const formatter = getFormat(opts.format as Formats);
    formatter.listStations(results);
  });
