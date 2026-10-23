import type { Formatter } from "./index.js";

function write(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export default function json(): Formatter {
  return {
    extremes(prediction) {
      write(prediction);
    },

    timeline(prediction) {
      write(prediction);
    },

    listStations(stations) {
      write(stations);
    },

    currentEvents(prediction) {
      write(prediction);
    },

    currentTimeline(prediction) {
      write(prediction);
    },

    currentSlackWindows(prediction) {
      write(prediction);
    },

    listCurrentStations(stations) {
      write(stations);
    },
  };
}
