import type {
  Units,
  Station,
  StationSummary,
  ExtremesResponse,
  TimelineResponse,
  CurrentStationInfo,
  CurrentStationSummary,
  CurrentEventsResponse,
  CurrentTimelineResponse,
} from "./types.js";

export interface PredictionParams {
  start?: string;
  end?: string;
  datum?: string;
  units?: Units;
}

export interface LocationParams extends PredictionParams {
  latitude: number;
  longitude: number;
}

export interface StationPredictionParams extends PredictionParams {
  id: string;
}

export interface StationsSearchParams {
  query?: string;
  latitude?: number;
  longitude?: number;
  maxResults?: number;
  maxDistance?: number;
  bbox?: string; // "minLon,minLat,maxLon,maxLat"
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** `path` starts with "/". */
function buildURL(base: string, path: string, params: object = {}): string {
  const normalizedBase = base.endsWith("/") ? base : base + "/";
  // Relative to the base's path, so an API mounted below the origin keeps its prefix.
  const url = new URL(path.slice(1), normalizedBase);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Parse a station ID like "noaa/8722588" into source and id path segments. */
function parseStationId(id: string): { source: string; stationId: string } {
  const slash = id.indexOf("/");
  if (slash === -1) throw new Error(`Invalid station ID: "${id}". Expected format "source/id".`);
  return { source: id.slice(0, slash), stationId: id.slice(slash + 1) };
}

/** Convert all Date properties to string (the raw JSON shape before parsing). */
type JSONResponse<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends (infer U)[]
      ? JSONResponse<U>[]
      : T[K] extends object
        ? JSONResponse<T[K]>
        : T[K];
};

type RawExtremesResponse = JSONResponse<ExtremesResponse>;
type RawTimelineResponse = JSONResponse<TimelineResponse>;

export async function fetchExtremes(
  baseUrl: string,
  params: LocationParams,
): Promise<ExtremesResponse> {
  const data = await fetchJSON<RawExtremesResponse>(buildURL(baseUrl, "/tides/extremes", params));
  return { ...data, extremes: data.extremes.map((e) => ({ ...e, time: new Date(e.time) })) };
}

export async function fetchTimeline(
  baseUrl: string,
  params: LocationParams,
): Promise<TimelineResponse> {
  const data = await fetchJSON<RawTimelineResponse>(buildURL(baseUrl, "/tides/timeline", params));
  return { ...data, timeline: data.timeline.map((e) => ({ ...e, time: new Date(e.time) })) };
}

export function fetchStation(baseUrl: string, id: string): Promise<Station> {
  const { source, stationId } = parseStationId(id);
  return fetchJSON(buildURL(baseUrl, `/tides/stations/${source}/${stationId}`));
}

export async function fetchStations(
  baseUrl: string,
  params: StationsSearchParams = {},
): Promise<StationSummary[]> {
  const stations = await fetchJSON<StationSummary[]>(buildURL(baseUrl, "/tides/stations", params));
  // Searches and bounding boxes don't say which routes serve a station, and lists mix both kinds.
  return stations.map((s) => ({ ...s, kind: "tide" }));
}

export async function fetchStationExtremes(
  baseUrl: string,
  params: StationPredictionParams,
): Promise<ExtremesResponse> {
  const { id, ...rest } = params;
  const { source, stationId } = parseStationId(id);
  const data = await fetchJSON<RawExtremesResponse>(
    buildURL(baseUrl, `/tides/stations/${source}/${stationId}/extremes`, rest),
  );
  return { ...data, extremes: data.extremes.map((e) => ({ ...e, time: new Date(e.time) })) };
}

export async function fetchStationTimeline(
  baseUrl: string,
  params: StationPredictionParams,
): Promise<TimelineResponse> {
  const { id, ...rest } = params;
  const { source, stationId } = parseStationId(id);
  const data = await fetchJSON<RawTimelineResponse>(
    buildURL(baseUrl, `/tides/stations/${source}/${stationId}/timeline`, rest),
  );
  return { ...data, timeline: data.timeline.map((e) => ({ ...e, time: new Date(e.time) })) };
}

/** Current stations by query, bounding box, or nearness: the same parameters as `fetchStations`. */
export async function fetchCurrentStations(
  baseUrl: string,
  params: StationsSearchParams = {},
): Promise<CurrentStationSummary[]> {
  const stations = await fetchJSON<CurrentStationSummary[]>(
    buildURL(baseUrl, "/currents/stations", params),
  );
  return stations.map((s) => ({ ...s, kind: "current" }));
}

export interface CurrentPredictionParams {
  id: string;
  start?: string;
  end?: string;
}

/**
 * Fetch a current station. `id` is "source/id", optionally with a bin
 * ("noaa/EPT0003@11"), or a bare id for curated records ("chs-active-pass").
 */
export function fetchCurrentStation(baseUrl: string, id: string): Promise<CurrentStationInfo> {
  return fetchJSON(buildURL(baseUrl, `/currents/stations/${id}`));
}

export async function fetchCurrentStationEvents(
  baseUrl: string,
  { id, ...params }: CurrentPredictionParams,
): Promise<CurrentEventsResponse> {
  const data = await fetchJSON<JSONResponse<CurrentEventsResponse>>(
    buildURL(baseUrl, `/currents/stations/${id}/events`, params),
  );
  return { ...data, events: data.events.map((e) => ({ ...e, time: new Date(e.time) })) };
}

export async function fetchCurrentStationTimeline(
  baseUrl: string,
  { id, ...params }: CurrentPredictionParams,
): Promise<CurrentTimelineResponse> {
  const data = await fetchJSON<JSONResponse<CurrentTimelineResponse>>(
    buildURL(baseUrl, `/currents/stations/${id}/timeline`, params),
  );
  return { ...data, timeline: data.timeline.map((e) => ({ ...e, time: new Date(e.time) })) };
}
