function scoped<T extends readonly unknown[]>(key: T, source?: string) {
  return source === undefined ? key : ([...key, { source }] as const);
}

export const queryKeys = {
  station: (id: string | undefined, source?: string) =>
    scoped(["slackwater", "station", id] as const, source),
  stations: (params: object, source?: string) =>
    scoped(["slackwater", "stations", params] as const, source),
  nearbyStations: (params: object, source?: string) =>
    scoped(["slackwater", "nearby-stations", params] as const, source),
  extremes: (params: object, source?: string) =>
    scoped(["slackwater", "extremes", params] as const, source),
  timeline: (params: object, source?: string) =>
    scoped(["slackwater", "timeline", params] as const, source),
  currentStations: (params: object, source?: string) =>
    scoped(["slackwater", "current-stations", params] as const, source),
  currentStation: (id: string | undefined, source?: string) =>
    scoped(["slackwater", "current-station", id] as const, source),
  currentEvents: (params: object, source?: string) =>
    scoped(["slackwater", "current-events", params] as const, source),
  currentTimeline: (params: object, source?: string) =>
    scoped(["slackwater", "current-timeline", params] as const, source),
};
