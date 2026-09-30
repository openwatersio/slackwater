import { getCurrentEventsPrediction, getCurrentTimelinePrediction, slackWindows } from "slackwater";

const options = {
  latitude: 48.406, // Deception Pass, WA
  longitude: -122.643,
  start: new Date("2026-06-01T00:00:00Z"),
  end: new Date("2026-06-02T00:00:00Z"),
};

// Slack, max flood, and max ebb events. Speeds are signed knots along the
// flood axis: positive is flood, negative is ebb.
const { station, events } = getCurrentEventsPrediction(options);
console.log(station.name);
for (const event of events) {
  const direction = event.direction === undefined ? "" : ` toward ${event.direction}°`;
  console.log(`${event.time.toISOString()} ${event.kind} ${event.speed.toFixed(1)} kn${direction}`);
}

// The signed speed curve, and the windows where |speed| stays under a
// threshold around a reversal — the transitable water.
const { timeline } = getCurrentTimelinePrediction(options);
for (const window of slackWindows(timeline, 0.5)) {
  console.log(`slack window ${window.start.toISOString()} – ${window.end.toISOString()}`);
}
