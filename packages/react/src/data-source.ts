import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  fetchStation,
  fetchStations,
  fetchTimeline,
  fetchExtremes,
  fetchStationTimeline,
  fetchStationExtremes,
  fetchCurrentStation,
  fetchCurrentStations,
  fetchCurrentStationEvents,
  fetchCurrentStationTimeline,
  type CurrentPredictionParams,
  type PredictionParams,
  type LocationParams,
  type StationsSearchParams,
} from "./client.js";
import type {
  Station,
  StationSummary,
  TimelineResponse,
  ExtremesResponse,
  CurrentStationInfo,
  CurrentStationSummary,
  CurrentEventsResponse,
  CurrentTimelineResponse,
} from "./types.js";

export type TidePredictionParams =
  | ({ id: string } & Omit<PredictionParams, "datum">)
  | (Omit<LocationParams, "datum"> & { id?: undefined });

/** Predictions contain Dates; sources own availability, licensing, and any network or engine work. */
export interface SlackwaterDataSource {
  /** Stable identity of the dataset, revision, and access policy; shared across SSR and hydration. */
  cacheKey: string;
  getStation(id: string): Promise<Station>;
  getStations(params: StationsSearchParams): Promise<StationSummary[]>;
  getTimeline(params: TidePredictionParams): Promise<TimelineResponse>;
  getExtremes(params: TidePredictionParams): Promise<ExtremesResponse>;
  getCurrentStation(id: string): Promise<CurrentStationInfo>;
  getCurrentStations(params: StationsSearchParams): Promise<CurrentStationSummary[]>;
  getCurrentEvents(params: CurrentPredictionParams): Promise<CurrentEventsResponse>;
  getCurrentTimeline(params: CurrentPredictionParams): Promise<CurrentTimelineResponse>;
}

function apiCacheKey(baseUrl: string): string {
  let base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  try {
    base = new URL(base).href;
  } catch {
    // Invalid URLs belong to the query's error state, just like other HTTP failures.
  }
  return `api:${bytesToHex(sha256(utf8ToBytes(base)))}`;
}

function validateCacheKey(cacheKey: string) {
  if (typeof cacheKey !== "string" || !cacheKey.trim())
    throw new Error("A data source needs a nonempty cacheKey.");
}

/** The HTTP source uses the existing client decoding and error handling. */
export function createApiDataSource(
  baseUrl: string,
  { cacheKey = apiCacheKey(baseUrl) }: { cacheKey?: string } = {},
): SlackwaterDataSource {
  validateCacheKey(cacheKey);
  return {
    cacheKey,
    getStation: (id) => fetchStation(baseUrl, id),
    getStations: (params) => fetchStations(baseUrl, params),
    getTimeline: (params) =>
      params.id
        ? fetchStationTimeline(baseUrl, params)
        : fetchTimeline(baseUrl, params as LocationParams),
    getExtremes: (params) =>
      params.id
        ? fetchStationExtremes(baseUrl, params)
        : fetchExtremes(baseUrl, params as LocationParams),
    getCurrentStation: (id) => fetchCurrentStation(baseUrl, id),
    getCurrentStations: (params) => fetchCurrentStations(baseUrl, params),
    getCurrentEvents: (params) => fetchCurrentStationEvents(baseUrl, params),
    getCurrentTimeline: (params) => fetchCurrentStationTimeline(baseUrl, params),
  };
}

export function resolveDataSource(
  source: string | SlackwaterDataSource | undefined,
): SlackwaterDataSource {
  if (typeof source === "string") return createApiDataSource(source);
  if (!source) throw new Error("Supply baseUrl or dataSource to SlackwaterProvider.");
  validateCacheKey(source.cacheKey);
  return source;
}
