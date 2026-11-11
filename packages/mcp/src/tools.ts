import { z } from "zod";
import {
  slackRuns,
  useCurrentStation,
  useStation,
  type CurrentEvent,
  type CurrentPoint,
} from "@slackwater/engine";
import type { Station } from "@slackwater/database";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Catalog, ToolError } from "./catalog.js";

const timestamp = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(200);
const spanShape = { station_id: id, start: timestamp, end: timestamp };
const spanSchema = z.object(spanShape);
type SpanInput = z.infer<typeof spanSchema>;
const day = 86400000;
export const maxResponseBytes = 256 * 1024;
function span(args: SpanInput) {
  const start = new Date(args.start),
    end = new Date(args.end);
  if (start >= end || end.getTime() - start.getTime() > 3 * day)
    throw new ToolError("invalid_input", "Request a positive interval of at most three days");
  return { start, end };
}
function define<T extends z.ZodType>(
  description: string,
  schema: T,
  handler: (args: z.infer<T>) => Promise<Record<string, unknown>>,
) {
  return { description, schema, call: (args: unknown) => handler(schema.parse(args)) };
}
function publicStation(info: ReturnType<Catalog["station"]>) {
  const { search: _search, aliases: _aliases, discoverable: _discoverable, ...station } = info;
  return station;
}
function inSpan<T extends { time: Date }>(events: T[], range: { start: Date; end: Date }) {
  return events.filter((e) => e.time >= range.start && e.time <= range.end);
}
async function model(catalog: Catalog, id: string, kind: Station["kind"]) {
  const station = await catalog.model(id);
  if (station.kind !== kind) throw new ToolError("wrong_kind", `Select a ${kind} station`);
  return station;
}
async function current(catalog: Catalog, id: string) {
  const record = await model(catalog, id, "current");
  const reference = !record.harmonic_constituents.length
    ? record.current?.offsets?.reference
    : undefined;
  return {
    record,
    predictor: useCurrentStation(
      { ...record, kind: "current" },
      {
        reference: reference ? { ...(await catalog.model(reference)), kind: "current" } : undefined,
      },
    ),
  };
}
function envelope(catalog: Catalog, id: string, range?: { start: Date; end: Date }) {
  const info = catalog.station(id);
  const credits = [info.attribution];
  if (info.reference) credits.push(catalog.station(info.reference).attribution);
  return {
    station: publicStation(info),
    interval: range,
    attribution: [...new Set(credits)],
    provenance: catalog.index.versions,
    notice: "Model predictions, not observations. Not for navigation.",
  };
}
export function createTools(catalog: Catalog) {
  return {
    find_stations: define(
      "Find tide or current stations by name or coordinates. Nearby results name actual distances; unavailable predictions are flagged. Select an exact canonical station ID before requesting predictions.",
      z.strictObject({
        kind: z.enum(["tide", "current"]),
        query: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        radius_nm: z.number().optional(),
      }),
      async (args) => {
        const found = catalog.find(args);
        return {
          ...found,
          stations: found.stations.map((s) => ({
            ...publicStation({ ...s, requested_id: s.id }),
            distance_nm: s.distance_nm,
          })),
          provenance: catalog.index.versions,
        };
      },
    ),
    get_station: define(
      "Inspect an exact canonical station ID, timezone, model availability, datums and depth bins. Diagnostics reveal model inputs only when the model may be served.",
      z.strictObject({ station_id: id, diagnostics: z.boolean().default(false) }),
      async (args) => ({
        ...envelope(catalog, args.station_id),
        ...(args.diagnostics ? { diagnostics: await catalog.model(args.station_id) } : {}),
      }),
    ),
    get_tide_prediction: define(
      "Predict high/low tide heights for an exact tide station, for at most three days. Specify RFC3339 times with offsets. Results name units, datum and station timezone; optional timeline uses ten-minute samples.",
      z.strictObject({
        ...spanShape,
        datum: z.string().optional(),
        units: z.enum(["meters", "feet"]).default("meters"),
        timeline: z.boolean().default(false),
      }),
      async (args) => {
        const range = span(args);
        const record = await model(catalog, args.station_id, "tide");
        if (args.datum && !Object.hasOwn(record.datums, args.datum))
          throw new ToolError(
            "invalid_datum",
            `Datum unavailable. Choose: ${Object.keys(record.datums).join(", ")}`,
          );
        const predictor = useStation(record);
        const options = { ...range, datum: args.datum, units: args.units };
        const result = predictor.getExtremesPrediction(options);
        return {
          ...envelope(catalog, args.station_id, range),
          datum: result.datum ?? null,
          units: result.units,
          events: inSpan(result.extremes, range),
          ...(args.timeline
            ? {
                timeline: predictor.getTimelinePrediction({ ...options, timeFidelity: 600 })
                  .timeline,
              }
            : {}),
        };
      },
    ),
    get_current_prediction: define(
      "Predict signed major-axis current events in knots for an exact station and at most three days. Positive means flood, negative ebb. A rounded zero is not slack. Optional diagnostics retain ten-minute vector samples and reference offsets.",
      z.strictObject({ ...spanShape, diagnostics: z.boolean().default(false) }),
      async (args) => {
        const range = span(args);
        const { record, predictor } = await current(catalog, args.station_id);
        return {
          ...envelope(catalog, args.station_id, range),
          units: "knots",
          events: inSpan(predictor.getEventsPrediction(range).events, range),
          ...(args.diagnostics
            ? {
                timeline: predictor.getTimelinePrediction({ ...range, timeFidelity: 600 }).timeline,
                diagnostics: { offsets: record.current?.offsets ?? null },
              }
            : {}),
        };
      },
    ),
    get_slack_windows: define(
      "Find windows around predicted slack events at an explicit major-axis speed threshold (0–10 knots). Zero returns exact slack instants. Non-reversing lulls are excluded. This does not identify full-vector minima or assess passage safety.",
      z.strictObject({ ...spanShape, threshold_kn: z.number().min(0).max(10) }),
      async (args) => {
        const range = span(args);
        const { predictor } = await current(catalog, args.station_id);
        const context = {
          start: new Date(range.start.getTime() - day),
          end: new Date(range.end.getTime() + day),
        };
        const events = predictor.getEventsPrediction(context).events;
        const timeline = predictor.getTimelinePrediction({
          ...context,
          timeFidelity: 600,
        }).timeline;
        return {
          ...envelope(catalog, args.station_id, range),
          threshold_kn: args.threshold_kn,
          threshold_basis: "major_axis",
          units: "knots",
          slack_events: inSpan(
            events.filter((e) => e.kind === "slack"),
            range,
          ),
          windows: windowResults(timeline, events, args.threshold_kn, range),
        };
      },
    ),
  };
}
export function windowResults(
  timeline: CurrentPoint[],
  events: CurrentEvent[],
  threshold: number,
  range: { start: Date; end: Date },
) {
  return slackRuns(timeline, events, threshold)
    .filter((w) => w.end >= range.start && w.start <= range.end)
    .map((w) => ({
      start: new Date(Math.max(w.start.getTime(), range.start.getTime())),
      end: new Date(Math.min(w.end.getTime(), range.end.getTime())),
      clipped_start: w.start < range.start,
      clipped_end: w.end > range.end,
      series_limited: w.start <= timeline[0].time || w.end >= timeline.at(-1)!.time,
      slack_times: events
        .filter((e) => e.kind === "slack" && e.time >= w.start && e.time <= w.end)
        .map((e) => e.time),
    }));
}
export function errorResult(error: unknown): CallToolResult {
  const code =
    error instanceof ToolError
      ? error.code
      : error instanceof z.ZodError
        ? "invalid_input"
        : "prediction_error";
  const message =
    error instanceof ToolError
      ? error.message
      : error instanceof z.ZodError
        ? "Arguments do not match the tool schema"
        : "The model could not produce this prediction";
  const value = { error: { code, message } };
  return {
    isError: true,
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}
export async function executeTool(
  catalog: Catalog,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const tools = createTools(catalog);
    if (!Object.hasOwn(tools, name)) throw new ToolError("unknown_tool", "Unknown tool");
    const value = JSON.parse(
      JSON.stringify(await tools[name as keyof typeof tools].call(args)),
    ) as Record<string, unknown>;
    const result: CallToolResult = {
      structuredContent: value,
      content: [{ type: "text", text: JSON.stringify(value) }],
    };
    // Reserve the maximum accepted request size for JSON-RPC ID and envelope overhead.
    if (new TextEncoder().encode(JSON.stringify(result)).length > maxResponseBytes - 16384)
      throw new ToolError(
        "result_too_large",
        "Shorten the interval or omit diagnostics to reduce the result size",
      );
    return result;
  } catch (error) {
    return errorResult(error);
  }
}
