export {
  createApiDataSource,
  type SlackwaterDataSource,
  type TidePredictionParams,
} from "./data-source.js";
export * from "./types.js";
export * from "./provider.js";
export * from "./client.js";
export * from "./hooks/index.js";
export * from "./components/index.js";
export * from "./query-keys.js";
export * from "./prefetch.js";

// Utilities
export { formatLevel, formatTime, formatDate, formatDistance } from "./utils/format.js";
export { getDefaultUnits } from "./utils/defaults.js";
export {
  fortnightWindow,
  nextMaxTile,
  outlookWindow,
  rangeTile,
  type TileContent,
} from "./utils/standing.js";
// For `rangeTile`'s fortnight, so a page needn't depend on the engine itself.
export { swingHeights } from "@slackwater/engine";

// Re-export hydration utilities from @tanstack/react-query
export { dehydrate, HydrationBoundary } from "@tanstack/react-query";
