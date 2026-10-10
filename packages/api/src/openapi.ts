import pkg from "../package.json" with { type: "json" };
import { datums } from "@slackwater/database";

const tides = {
  openapi: "3.0.3",
  info: {
    title: "Slackwater Tide Prediction API",
    version: pkg.version,
    description: pkg.description,
    license: {
      name: "MIT",
    },
  },
  paths: {
    "/": {
      get: {
        summary: "API information",
        responses: {
          "200": {
            description: "API information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    version: { type: "string" },
                    docs: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/extremes": {
      get: {
        summary: "Get extremes prediction for a location",
        description:
          "Returns high and low tide predictions for the nearest station to the given coordinates",
        parameters: [
          { $ref: "#/components/parameters/latitude" },
          { $ref: "#/components/parameters/longitude" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
          { $ref: "#/components/parameters/datum" },
          { $ref: "#/components/parameters/units" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ExtremesResponse",
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/timeline": {
      get: {
        summary: "Get timeline prediction for a location",
        description: "Returns water level predictions at regular intervals for the nearest station",
        parameters: [
          { $ref: "#/components/parameters/latitude" },
          { $ref: "#/components/parameters/longitude" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
          { $ref: "#/components/parameters/datum" },
          { $ref: "#/components/parameters/units" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TimelineResponse",
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/stations/{source}/{id}": {
      get: {
        summary: "Get station by ID",
        description: "Find a station by its ID",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/stationId" },
        ],
        responses: {
          "200": {
            description: "Station found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Station",
                },
              },
            },
          },
          "404": {
            description: "Station not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/stations": {
      get: {
        summary: "Find stations",
        description:
          "Search stations by name/ID, find stations near the given coordinates, or list all stations when no filters are provided",
        parameters: [
          { $ref: "#/components/parameters/stationQuery" },
          { $ref: "#/components/parameters/optionalLatitude" },
          { $ref: "#/components/parameters/optionalLongitude" },
          { $ref: "#/components/parameters/maxResults" },
          { $ref: "#/components/parameters/maxDistance" },
          { $ref: "#/components/parameters/bbox" },
        ],
        responses: {
          "200": {
            description: "Stations found",
            content: {
              "application/json": {
                schema: {
                  anyOf: [
                    {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/Station",
                      },
                    },
                    {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/StationSummary",
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/stations/{source}/{id}/extremes": {
      get: {
        summary: "Get extremes prediction for a specific station",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/stationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
          { $ref: "#/components/parameters/datum" },
          { $ref: "#/components/parameters/units" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ExtremesResponse",
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "404": {
            description: "Station not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/stations/{source}/{id}/timeline": {
      get: {
        summary: "Get timeline prediction for a specific station",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/stationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
          { $ref: "#/components/parameters/datum" },
          { $ref: "#/components/parameters/units" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TimelineResponse",
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "404": {
            description: "Station not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "Get OpenAPI specification",
        responses: {
          "200": {
            description: "OpenAPI specification",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      latitude: {
        name: "latitude",
        in: "query",
        description: "Latitude",
        required: true,
        schema: {
          type: "number",
          minimum: -90,
          maximum: 90,
        },
      },
      longitude: {
        name: "longitude",
        in: "query",
        description: "Longitude",
        required: true,
        schema: {
          type: "number",
          minimum: -180,
          maximum: 180,
        },
      },
      start: {
        name: "start",
        in: "query",
        required: false,
        description: "Start date/time (ISO 8601 format, defaults to now)",
        schema: {
          type: "string",
          format: "date-time",
        },
      },
      end: {
        name: "end",
        in: "query",
        required: false,
        description: "End date/time (ISO 8601 format, defaults to 7 days from start)",
        schema: {
          type: "string",
          format: "date-time",
        },
      },
      datum: {
        name: "datum",
        in: "query",
        required: false,
        description: "Vertical datum (defaults to station's chart datum)",
        schema: {
          type: "string",
          enum: datums,
        },
      },
      units: {
        name: "units",
        in: "query",
        required: false,
        description: "Units for water levels (defaults to meters)",
        schema: {
          type: "string",
          enum: ["meters", "feet"],
          default: "meters",
        },
      },
      stationSource: {
        name: "source",
        in: "path",
        required: true,
        description: "Station source (e.g., 'noaa', 'ticon')",
        schema: {
          type: "string",
        },
      },
      stationId: {
        name: "id",
        in: "path",
        required: true,
        description: "Station ID within the source (e.g., '8722588', 'some-dash-string')",
        schema: {
          type: "string",
        },
      },
      stationQuery: {
        name: "query",
        in: "query",
        description: "Full-text search query (name, ID, or location)",
        required: false,
        allowReserved: true,
        schema: { type: "string" },
      },
      optionalLatitude: {
        name: "latitude",
        in: "query",
        description: "Latitude for proximity search",
        required: false,
        schema: { type: "number", minimum: -90, maximum: 90 },
      },
      optionalLongitude: {
        name: "longitude",
        in: "query",
        description: "Longitude for proximity search",
        required: false,
        schema: { type: "number", minimum: -180, maximum: 180 },
      },
      maxResults: {
        name: "maxResults",
        in: "query",
        description: "Maximum number of stations to return",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      maxDistance: {
        name: "maxDistance",
        in: "query",
        description: "Maximum search radius for proximity search, in kilometers",
        required: false,
        schema: { type: "number", minimum: 0 },
      },
      bbox: {
        name: "bbox",
        in: "query",
        description:
          "Bounding box in GeoJSON order: minLon,minLat,maxLon,maxLat (longitude first). Longitudes must be within -180..180, latitudes within -90..90, and minLat <= maxLat. minLon > maxLon denotes an antimeridian crossing.",
        required: false,
        schema: {
          type: "string",
          pattern: "^-?[\\d.]+,-?[\\d.]+,-?[\\d.]+,-?[\\d.]+$",
        },
      },
    },
    schemas: {
      StationSummary: {
        type: "object",
        properties: {
          id: {
            type: "string",
          },
          name: {
            type: "string",
          },
          latitude: {
            type: "number",
          },
          longitude: {
            type: "number",
          },
          region: {
            type: "string",
          },
          country: {
            type: "string",
          },
          continent: {
            type: "string",
          },
          timezone: {
            type: "string",
          },
          type: {
            type: "string",
            enum: ["reference", "subordinate"],
          },
        },
      },
      Station: {
        type: "object",
        properties: {
          id: {
            type: "string",
          },
          name: {
            type: "string",
          },
          latitude: {
            type: "number",
          },
          longitude: {
            type: "number",
          },
          region: {
            type: "string",
          },
          country: {
            type: "string",
          },
          continent: {
            type: "string",
          },
          timezone: {
            type: "string",
          },
          type: {
            type: "string",
            enum: ["reference", "subordinate"],
          },
          source: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              url: { type: "string" },
            },
          },
          license: {
            type: "object",
            properties: {
              type: { type: "string" },
              commercial_use: { type: "boolean" },
              url: { type: "string" },
              notes: { type: "string" },
            },
          },
          disclaimers: {
            type: "string",
          },
          distance: {
            type: "number",
            description: "Distance from query point in kilometers (only for proximity searches)",
          },
          datums: {
            type: "object",
            properties: Object.fromEntries(datums.map((d) => [d, { type: "number" as const }])),
            additionalProperties: { type: "number" },
          },
          harmonic_constituents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amplitude: { type: "number" },
                phase: { type: "number" },
              },
            },
          },
          defaultDatum: {
            type: "string",
          },
          offsets: {
            type: "object",
            properties: {
              reference: { type: "string" },
              height: {
                type: "object",
                properties: {
                  high: { type: "number" },
                  low: { type: "number" },
                  type: { type: "string", enum: ["ratio", "fixed"] },
                },
              },
              time: {
                type: "object",
                properties: {
                  high: { type: "number" },
                  low: { type: "number" },
                },
              },
            },
          },
        },
      },
      Extreme: {
        type: "object",
        properties: {
          time: {
            type: "string",
            format: "date-time",
          },
          level: {
            type: "number",
          },
          high: {
            type: "boolean",
          },
          low: {
            type: "boolean",
          },
          label: {
            type: "string",
          },
        },
        required: ["time", "level", "high", "low", "label"],
      },
      ExtremesResponse: {
        type: "object",
        properties: {
          datum: {
            type: "string",
          },
          units: {
            type: "string",
            enum: ["meters", "feet"],
          },
          station: {
            $ref: "#/components/schemas/Station",
          },
          distance: {
            type: "number",
          },
          extremes: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Extreme",
            },
          },
        },
      },
      TimelineEntry: {
        type: "object",
        properties: {
          time: {
            type: "string",
            format: "date-time",
          },
          level: {
            type: "number",
          },
        },
        required: ["time", "level"],
      },
      TimelineResponse: {
        type: "object",
        properties: {
          datum: {
            type: "string",
          },
          units: {
            type: "string",
            enum: ["meters", "feet"],
          },
          station: {
            $ref: "#/components/schemas/Station",
          },
          distance: {
            type: "number",
          },
          timeline: {
            type: "array",
            items: {
              $ref: "#/components/schemas/TimelineEntry",
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
          errors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                message: { type: "string" },
                errorCode: { type: "string" },
              },
            },
          },
        },
        required: ["message"],
      },
    },
  },
} as const;

export default tides;

/** The current routes' spec. Shares the tide spec's parameters and schemas. */
export const currentsOpenapi = {
  openapi: "3.0.3",
  info: {
    title: "Slackwater Current Prediction API",
    version: pkg.version,
    description: "HTTP JSON API for tidal current predictions using harmonic constituents",
    license: {
      name: "MIT",
    },
  },
  paths: {
    "/": tides.paths["/"],
    "/openapi.json": tides.paths["/openapi.json"],
    "/events": {
      get: {
        summary: "Get current events for a location",
        description:
          "Returns slack water, maximum flood, and maximum ebb between start and end for the nearest current station, skipping stations with no model. When that station's source forbids redistributing its predictions the request is refused with 451 rather than answered from a station farther away. end must be within 366 days of start.",
        parameters: [
          { $ref: "#/components/parameters/latitude" },
          { $ref: "#/components/parameters/longitude" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentEventsResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description:
              "The nearest current station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/timeline": {
      get: {
        summary: "Get current speed timeline for a location",
        description:
          "Returns signed current speed every 10 minutes for the nearest current station, skipping stations with no model and refused with 451 when that station's source forbids redistributing its predictions. end must be within 366 days of start.",
        parameters: [
          { $ref: "#/components/parameters/latitude" },
          { $ref: "#/components/parameters/longitude" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentTimelineResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description:
              "The nearest current station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations": {
      get: {
        summary: "Find current stations",
        description:
          "Search current stations by name/ID, find them near the given coordinates, or list all. Each station appears once, at its primary bin, with its other bins listed in `bins`. Stations whose predictions can't be served are included with `predictions: false`.",
        parameters: [
          { $ref: "#/components/parameters/stationQuery" },
          { $ref: "#/components/parameters/optionalLatitude" },
          { $ref: "#/components/parameters/optionalLongitude" },
          { $ref: "#/components/parameters/maxResults" },
          { $ref: "#/components/parameters/maxDistance" },
          { $ref: "#/components/parameters/bbox" },
        ],
        responses: {
          "200": {
            description: "Current stations found",
            content: {
              "application/json": {
                schema: {
                  anyOf: [
                    { type: "array", items: { $ref: "#/components/schemas/CurrentStation" } },
                    {
                      type: "array",
                      items: { $ref: "#/components/schemas/CurrentStationSummary" },
                    },
                  ],
                },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{source}/{id}": {
      get: {
        summary: "Get current station by ID",
        description:
          "Find a current station by its ID. An ID without a bin is the station's primary bin; append `@N` for bin N.",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/currentStationId" },
        ],
        responses: {
          "200": {
            description: "Station found",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CurrentStation" } },
            },
          },
          "404": {
            description: "Station or bin not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{id}": {
      get: {
        summary: "Get current station by ID",
        description:
          "Find a current station by its ID. An ID without a bin is the station's primary bin; append `@N` for bin N.",
        parameters: [{ $ref: "#/components/parameters/unprefixedCurrentStationId" }],
        responses: {
          "200": {
            description: "Station found",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CurrentStation" } },
            },
          },
          "404": {
            description: "Station or bin not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{source}/{id}/events": {
      get: {
        summary: "Get current events for a specific station",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/currentStationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentEventsResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Station or bin not found, or the station has no model to predict from",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description: "The station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{id}/events": {
      get: {
        summary: "Get current events for a specific station",
        parameters: [
          { $ref: "#/components/parameters/unprefixedCurrentStationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentEventsResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Station or bin not found, or the station has no model to predict from",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description: "The station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{source}/{id}/timeline": {
      get: {
        summary: "Get current speed timeline for a specific station",
        parameters: [
          { $ref: "#/components/parameters/stationSource" },
          { $ref: "#/components/parameters/currentStationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentTimelineResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Station or bin not found, or the station has no model to predict from",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description: "The station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/stations/{id}/timeline": {
      get: {
        summary: "Get current speed timeline for a specific station",
        parameters: [
          { $ref: "#/components/parameters/unprefixedCurrentStationId" },
          { $ref: "#/components/parameters/start" },
          { $ref: "#/components/parameters/end" },
        ],
        responses: {
          "200": {
            description: "Successful prediction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentTimelineResponse" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Station or bin not found, or the station has no model to predict from",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "451": {
            description: "The station's source does not allow its predictions to be redistributed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      ...tides.components.parameters,
      currentStationId: {
        name: "id",
        in: "path",
        required: true,
        description:
          "Current station ID within the source, optionally with a depth bin (e.g. 'EPT0003' for the primary bin, 'EPT0003@11' for bin 11)",
        schema: {
          type: "string",
        },
      },
      unprefixedCurrentStationId: {
        name: "id",
        in: "path",
        required: true,
        description: "Current station ID with no source prefix (e.g. 'chs-active-pass')",
        schema: {
          type: "string",
        },
      },
    },
    schemas: {
      ...tides.components.schemas,
      CurrentBin: {
        type: "object",
        properties: {
          id: { type: "string", description: "Station ID for this bin" },
          bin: {
            type: "integer",
            description:
              "Bin number; absent for the primary bin, which the bare station ID selects",
          },
        },
        required: ["id"],
      },
      CurrentAvailability: {
        type: "object",
        properties: {
          bins: {
            type: "array",
            description: "Every depth bin of this station, primary first",
            items: { $ref: "#/components/schemas/CurrentBin" },
          },
          predictions: {
            type: "boolean",
            description: "Whether this API can serve predictions for the station",
          },
          unavailable: {
            type: "string",
            description: "Why predictions can't be served, when `predictions` is false",
          },
        },
        required: ["bins", "predictions"],
      },
      CurrentStationSummary: {
        allOf: [
          { $ref: "#/components/schemas/StationSummary" },
          { $ref: "#/components/schemas/CurrentAvailability" },
        ],
      },
      CurrentStation: {
        allOf: [
          { $ref: "#/components/schemas/Station" },
          { $ref: "#/components/schemas/CurrentAvailability" },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["current"] },
              current: {
                type: "object",
                properties: {
                  flood_direction: { type: "number", description: "Degrees true" },
                  ebb_direction: { type: "number", description: "Degrees true" },
                  mean_flow: { type: "number", description: "Knots" },
                  offsets: {
                    type: "object",
                    description:
                      "Subordinate stations only. Times in minutes, ratios dimensionless.",
                    properties: {
                      reference: { type: "string" },
                      slack_before_flood: { type: "number" },
                      slack_before_ebb: { type: "number" },
                      flood_time: { type: "number" },
                      ebb_time: { type: "number" },
                      flood_speed_ratio: { type: "number" },
                      ebb_speed_ratio: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      CurrentEvent: {
        type: "object",
        properties: {
          time: { type: "string", format: "date-time" },
          speed: {
            type: "number",
            description:
              "Signed knots along the flood axis: positive flood, negative ebb. Slack carries the near-zero residual.",
          },
          kind: { type: "string", enum: ["slack", "maxFlood", "maxEbb"] },
          direction: {
            type: "number",
            description:
              "Flood or ebb direction in degrees true; absent for slack and when the station has none",
          },
        },
        required: ["time", "speed", "kind"],
      },
      CurrentTimelineEntry: {
        type: "object",
        properties: {
          time: { type: "string", format: "date-time" },
          hour: { type: "number", description: "Hours since the first sample" },
          speed: {
            type: "number",
            description: "Signed knots along the flood axis: positive flood, negative ebb",
          },
        },
        required: ["time", "speed"],
      },
      CurrentPredictionResponse: {
        type: "object",
        properties: {
          units: { type: "string", enum: ["knots"] },
          floodDirection: { type: "number", description: "Degrees true, when the station has one" },
          ebbDirection: { type: "number", description: "Degrees true, when the station has one" },
          station: { $ref: "#/components/schemas/CurrentStation" },
          distance: {
            type: "number",
            description: "Distance from the query point in kilometers (location queries only)",
          },
        },
        required: ["units", "station"],
      },
      CurrentEventsResponse: {
        allOf: [
          { $ref: "#/components/schemas/CurrentPredictionResponse" },
          {
            type: "object",
            properties: {
              events: { type: "array", items: { $ref: "#/components/schemas/CurrentEvent" } },
            },
            required: ["events"],
          },
        ],
      },
      CurrentTimelineResponse: {
        allOf: [
          { $ref: "#/components/schemas/CurrentPredictionResponse" },
          {
            type: "object",
            properties: {
              timeline: {
                type: "array",
                items: { $ref: "#/components/schemas/CurrentTimelineEntry" },
              },
            },
            required: ["timeline"],
          },
        ],
      },
    },
  },
} as const;
