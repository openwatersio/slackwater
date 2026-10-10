import chalk from "chalk";
import Table from "cli-table3";
import type { Formatter, StationResult } from "./index.js";
import type { CurrentEventsResult, CurrentStationResult } from "../lib/currents.js";

const EVENT_LABELS = {
  slack: chalk.green("Slack"),
  maxFlood: chalk.blue("Max flood"),
  maxEbb: chalk.yellow("Max ebb"),
};

export default function text(): Formatter {
  return {
    extremes(prediction) {
      const { station, datum, units, extremes } = prediction;
      const unit = units === "meters" ? "m" : "ft";
      const tz = station.timezone;

      console.log(chalk.bold(station.name));
      console.log(chalk.dim(`${datum}  ·  ${units}`));
      console.log();

      const table = new Table({
        head: ["Date", "Time", "Type", "Level"],
        style: { head: [], border: [] },
      });

      let lastDate = "";
      for (const e of extremes) {
        const date = formatDate(e.time, tz);
        const tag = e.high ? chalk.green("High") : chalk.blue("Low");
        table.push([
          date !== lastDate ? date : "",
          formatTime(e.time, tz),
          tag,
          { content: `${e.level.toFixed(2)} ${unit}`, hAlign: "right" },
        ]);
        lastDate = date;
      }

      console.log(table.toString());
    },

    timeline(prediction) {
      const { station, datum, units, timeline } = prediction;
      const unit = units === "meters" ? "m" : "ft";
      const tz = station.timezone;

      console.log(chalk.bold(station.name));
      console.log(chalk.dim(`${datum}  ·  ${units}`));
      console.log();

      const table = new Table({
        head: ["Date", "Time", "Level"],
        style: { head: [], border: [] },
      });

      let lastDate = "";
      for (const point of timeline) {
        const date = formatDate(point.time, tz);
        table.push([
          date !== lastDate ? date : "",
          formatTime(point.time, tz),
          { content: `${point.level.toFixed(2)} ${unit}`, hAlign: "right" },
        ]);
        lastDate = date;
      }

      console.log(table.toString());
    },

    listStations(stations: StationResult[]) {
      const hasDistance = stations.some((s) => s.distance != null);

      const head = hasDistance
        ? ["ID", "Name", "Region", "Distance"]
        : ["ID", "Name", "Region", "Country"];

      const table = new Table({
        head,
        style: { head: [], border: [] },
      });

      for (const s of stations) {
        const lastCol =
          hasDistance && s.distance != null ? `${s.distance.toFixed(1)} km` : s.country;
        table.push([s.id, s.name, s.region ?? "", lastCol]);
      }

      console.log(table.toString());
      console.log();
      console.log(chalk.dim(`${stations.length} station${stations.length === 1 ? "" : "s"} found`));
    },

    currentEvents(prediction) {
      const { station, events } = prediction;
      const tz = station.timezone;
      currentHeader(prediction);

      if (!events.length) {
        console.log(chalk.dim("No slack or max current in this period"));
        return;
      }

      const table = new Table({
        head: ["Date", "Time", "Event", "Speed", "Direction"],
        style: { head: [], border: [] },
      });

      let lastDate = "";
      for (const e of events) {
        const date = formatDate(e.time, tz);
        const max = e.kind !== "slack";
        table.push([
          date !== lastDate ? date : "",
          formatTime(e.time, tz),
          EVENT_LABELS[e.kind],
          { content: max ? formatKnots(e.speed) : "", hAlign: "right" },
          {
            content: e.direction !== undefined ? formatDirection(e.direction) : "",
            hAlign: "right",
          },
        ]);
        lastDate = date;
      }

      console.log(table.toString());
    },

    currentTimeline(prediction) {
      const { station, timeline } = prediction;
      const tz = station.timezone;
      currentHeader(prediction);

      const table = new Table({
        head: ["Date", "Time", "Current", "Speed"],
        style: { head: [], border: [] },
      });

      let lastDate = "";
      for (const point of timeline) {
        const date = formatDate(point.time, tz);
        table.push([
          date !== lastDate ? date : "",
          formatTime(point.time, tz),
          Math.abs(point.speed) < 0.05
            ? chalk.green("Slack")
            : point.speed < 0
              ? chalk.yellow("Ebb")
              : chalk.blue("Flood"),
          { content: formatKnots(point.speed), hAlign: "right" },
        ]);
        lastDate = date;
      }

      console.log(table.toString());
    },

    currentSlackWindows(prediction) {
      const { station, threshold, windows } = prediction;
      const tz = station.timezone;
      currentHeader(prediction, `below ${threshold} kn`);

      if (!windows.length) {
        console.log(chalk.dim(`No slack windows below ${threshold} kn in this period`));
        return;
      }

      const table = new Table({
        head: ["Date", "Start", "End", "Duration"],
        style: { head: [], border: [] },
      });

      let lastDate = "";
      for (const w of windows) {
        const date = formatDate(w.start, tz);
        table.push([
          date !== lastDate ? date : "",
          formatTime(w.start, tz),
          formatDate(w.end, tz) === date
            ? formatTime(w.end, tz)
            : `${formatDate(w.end, tz)} ${formatTime(w.end, tz)}`,
          {
            content: `${w.clipped ? "≥ " : ""}${formatDuration(w.end.getTime() - w.start.getTime())}`,
            hAlign: "right",
          },
        ]);
        lastDate = date;
      }

      console.log(table.toString());
      if (windows.some((w) => w.clipped)) {
        console.log(
          chalk.dim(
            "≥ The window runs past the start or end of the period, so it lasts longer than shown.",
          ),
        );
      }
    },

    listCurrentStations(stations: CurrentStationResult[]) {
      const hasDistance = stations.some((s) => s.distance != null);

      const table = new Table({
        head: ["ID", "Name", "Region", hasDistance ? "Distance" : "Country", "Bins", "Predictions"],
        style: { head: [], border: [] },
      });

      for (const s of stations) {
        table.push([
          s.id,
          s.name,
          s.region ?? "",
          s.distance != null ? `${s.distance.toFixed(1)} km` : s.country,
          { content: String(s.bins.length), hAlign: "right" },
          s.predictions ? "yes" : chalk.dim("no"),
        ]);
      }

      console.log(table.toString());
      console.log();
      console.log(chalk.dim(`${stations.length} station${stations.length === 1 ? "" : "s"} found`));
      if (stations.some((s) => !s.predictions)) {
        console.log(
          chalk.dim(
            'Run "slackwater currents --station <id>" on a station without predictions to see why.',
          ),
        );
      }
    },
  };
}

/** Station name, then id, units, flood and ebb directions, and distance when known. */
function currentHeader(prediction: Omit<CurrentEventsResult, "events">, extra?: string) {
  const { station, floodDirection, ebbDirection, distance } = prediction;
  const details = [
    station.id,
    "knots",
    floodDirection !== undefined && `flood ${formatDirection(floodDirection)}`,
    ebbDirection !== undefined && `ebb ${formatDirection(ebbDirection)}`,
    distance !== undefined && `${distance.toFixed(1)} km away`,
    extra,
  ].filter(Boolean);

  console.log(chalk.bold(station.name));
  console.log(chalk.dim(details.join("  ·  ")));
  console.log();
}

/** Speed magnitude: the event or Flood/Ebb label carries the sign. */
function formatKnots(speed: number): string {
  return `${Math.abs(speed).toFixed(1)} kn`;
}

function formatDirection(degrees: number): string {
  return `${Math.round(degrees) % 360}°T`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
