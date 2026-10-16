export const queryKeys = {
  station: (id: string | undefined) => ["slackwater", "station", id] as const,
  stations: (params: object) => ["slackwater", "stations", params] as const,
  nearbyStations: (params: object) => ["slackwater", "nearby-stations", params] as const,
  extremes: (params: object) => ["slackwater", "extremes", params] as const,
  timeline: (params: object) => ["slackwater", "timeline", params] as const,
  currentStations: (params: object) => ["slackwater", "current-stations", params] as const,
  currentStation: (id: string | undefined) => ["slackwater", "current-station", id] as const,
  currentEvents: (params: object) => ["slackwater", "current-events", params] as const,
  currentTimeline: (params: object) => ["slackwater", "current-timeline", params] as const,
};
