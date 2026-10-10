import { Command, Option } from "commander";
import { search, stations as allStations, near } from "@slackwater/database";
import getFormat, { type Formats } from "../formatters/index.js";
import { resolveCoordinates } from "../lib/station.js";
import { positiveInteger, positiveNumber, stationLimit } from "../lib/options.js";
import {
  resolveCurrentStation,
  currentEvents,
  currentTimeline,
  currentSlackWindows,
  describeCurrentStation,
  primaryCurrent,
  type CurrentStationResult,
  type Span,
} from "../lib/currents.js";

const HOUR_MS = 60 * 60 * 1000;

// The same limit as the API's current endpoints. A year of one-minute samples
// (`slack`, or `timeline --interval 1`) is about half a million points.
const MAX_SPAN_DAYS = 366;

function formatOption() {
  return new Option("-f, --format <format>", "output format")
    .choices(["text", "json"])
    .default("text");
}

/** A prediction subcommand: station selection, a time span, and an output format. */
function predictionCommand(name: string, description: string, defaultHours: number) {
  return new Command(name)
    .description(description)
    .option("-s, --station <id>", "station ID; append @N for depth bin N (e.g. noaa/EPT0003@11)")
    .option("-n, --near <lat,lon>", "find nearest current station to coordinates")
    .option("--ip", "use IP geolocation to find nearest current station")
    .option("--start <date>", "start date (ISO format, default: now)")
    .option("--end <date>", `end date (ISO format, default: ${defaultHours}h from start)`)
    .addOption(formatOption());
}

function parseSpan(opts: { start?: string; end?: string }, defaultHours: number): Span {
  const start = opts.start ? new Date(opts.start) : new Date();
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid start date: "${opts.start}"`);
  const end = opts.end ? new Date(opts.end) : new Date(start.getTime() + defaultHours * HOUR_MS);
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid end date: "${opts.end}"`);
  if (end.getTime() <= start.getTime()) throw new Error("End date must be after start date");
  if (end.getTime() - start.getTime() > MAX_SPAN_DAYS * 24 * HOUR_MS) {
    throw new Error(`End date must be within ${MAX_SPAN_DAYS} days of start date`);
  }
  return { start, end };
}

const events = predictionCommand(
  "events",
  "Get slack water, max flood, and max ebb for a current station",
  72,
).action(async (opts) => {
  const span = parseSpan(opts, 72);
  const station = await resolveCurrentStation(opts);
  getFormat(opts.format as Formats).currentEvents(currentEvents(station, span));
});

const timeline = predictionCommand("timeline", "Get a current speed timeline for a station", 24)
  .option("--interval <minutes>", "minutes between data points", "60")
  .action(async (opts) => {
    const span = parseSpan(opts, 24);
    const timeFidelity = positiveInteger(opts.interval, "interval") * 60;
    const station = await resolveCurrentStation(opts);
    getFormat(opts.format as Formats).currentTimeline(
      currentTimeline(station, { ...span, timeFidelity }),
    );
  });

const slack = predictionCommand(
  "slack",
  "Get slack water windows: the times the current runs below a speed around each turn",
  72,
)
  .option("-t, --threshold <knots>", "speed in knots the current must stay below", "0.5")
  .action(async (opts) => {
    const span = parseSpan(opts, 72);
    const threshold = positiveNumber(opts.threshold, "threshold");
    const station = await resolveCurrentStation(opts);
    getFormat(opts.format as Formats).currentSlackWindows(
      currentSlackWindows(station, { ...span, threshold }),
    );
  });

const stations = new Command("stations")
  .description("Search for tidal current stations")
  .argument("[query]", "search by name, region, country, or ID")
  .option("-n, --near <lat,lon>", "find current stations near coordinates")
  .option("--ip", "use IP geolocation to find nearest current stations")
  .option("-l, --limit <n>", "maximum number of results", "10")
  .option("-a, --all", "show all matching stations (no limit)")
  .addOption(formatOption())
  .action(async (query: string | undefined, opts) => {
    const limit = stationLimit(opts);
    let results: CurrentStationResult[];

    if (opts.near || opts.ip) {
      const coords = await resolveCoordinates(opts);
      let filter = primaryCurrent;
      if (query) {
        const matches = new Set(
          search(query, { filter: primaryCurrent, maxResults: Infinity }).map((s) => s.id),
        );
        filter = (s) => matches.has(s.id);
      }
      results = near({ ...coords, maxResults: limit, filter }).map(([station, distance]) => ({
        ...station,
        distance,
        ...describeCurrentStation(station),
      }));
    } else {
      const found = query
        ? search(query, { maxResults: limit, filter: primaryCurrent })
        : allStations.filter(primaryCurrent).slice(0, limit);
      results = found.map((station) => ({ ...station, ...describeCurrentStation(station) }));
    }

    if (!results.length) {
      throw new Error("No current stations found");
    }

    getFormat(opts.format as Formats).listCurrentStations(results);
  });

export default new Command("currents")
  .description("Get tidal current predictions (speeds in knots: positive flood, negative ebb)")
  .addCommand(events, { isDefault: true })
  .addCommand(timeline)
  .addCommand(slack)
  .addCommand(stations);
