export type Units = "meters" | "feet";

export interface StationSummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  region?: string;
  country: string;
  continent: string;
  timezone: string;
  type: "reference" | "subordinate";
  distance?: number;
}

export interface Station extends StationSummary {
  source: {
    id: string;
    name: string;
    url: string;
  };
  license: {
    type: string;
    commercial_use: boolean;
    url?: string;
    notes?: string;
  };
  disclaimers?: string;
  attribution?: string;
  datums: Record<string, number>;
  /** The datum predictions default to: the station's chart datum. */
  defaultDatum?: string;
  chart_datum?: string;
  harmonic_constituents: {
    name: string;
    amplitude: number;
    phase: number;
  }[];
  offsets?: {
    reference: string;
    height?: {
      high: number;
      low: number;
      type: "ratio" | "fixed";
    };
    time?: {
      high: number;
      low: number;
    };
  };
}

export interface Extreme {
  time: Date;
  level: number;
  high: boolean;
  low: boolean;
  label: string;
}

export interface TimelineEntry {
  time: Date;
  level: number;
}

export interface ExtremesResponse {
  datum: string;
  units: Units;
  station: Station;
  distance: number;
  extremes: Extreme[];
}

export interface TimelineResponse {
  datum: string;
  units: Units;
  station: Station;
  distance: number;
  timeline: TimelineEntry[];
}

export interface CurrentBin {
  id: string;
  /** Absent for the primary bin, which the bare station ID selects. */
  bin?: number;
}

/** A current station as the current API returns it: the database record plus serving flags. */
export interface CurrentStationInfo extends StationSummary {
  kind: "current";
  locality?: string;
  context?: string;
  source: {
    id: string;
    name: string;
    url: string;
    published_harmonics: boolean;
  };
  license: {
    type: string;
    commercial_use: boolean;
    url: string;
    notes?: string;
  };
  disclaimers?: string;
  attribution?: string;
  bins: CurrentBin[];
  /** False for stations the API can't serve (CHS licensing, no model). */
  predictions: boolean;
  unavailable?: string;
  current?: {
    /** Degrees true. Absent when the station publishes none. */
    flood_direction?: number;
    ebb_direction?: number;
    /** Net drift after the tide averages out, in knots: positive toward flood. */
    mean_flow?: number;
    /** A subordinate station's reference, "source/id[@bin]". */
    offsets?: { reference: string };
  };
}

export type CurrentEventKind = "slack" | "maxFlood" | "maxEbb";

export interface CurrentEvent {
  time: Date;
  /** Signed knots: positive flood, negative ebb. */
  speed: number;
  kind: CurrentEventKind;
  /** Degrees true; absent for slack and when the station has none. */
  direction?: number;
}

export interface CurrentTimelineEntry {
  time: Date;
  /** Signed knots: positive flood, negative ebb. */
  speed: number;
}

export interface CurrentEventsResponse {
  units: "knots";
  station: CurrentStationInfo;
  events: CurrentEvent[];
}

export interface CurrentTimelineResponse {
  units: "knots";
  station: CurrentStationInfo;
  timeline: CurrentTimelineEntry[];
}
