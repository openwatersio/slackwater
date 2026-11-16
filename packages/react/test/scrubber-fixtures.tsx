import { CurrentScrubber } from "../src/components/CurrentScrubber.js";
import { TideScrubber, type TideScrubberProps } from "../src/components/TideScrubber.js";
import type { CurrentEvent, Extreme } from "../src/types.js";

export const H = 3_600_000;
const M = 60_000;
export const t0 = Date.UTC(2026, 9, 10);
export const NOW = t0 + 25 * H;
export const LATER = t0 + 61 * H;

// Rounded as an API's predictions are: Node and the browser can differ in a sine's last bit.
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** A 12-hour sine sampled every 10 minutes, with its highs and lows. */
export function tides(hours = 96) {
  const level = (h: number) => round(1 + Math.sin((2 * Math.PI * h) / 12));
  const timeline = Array.from({ length: hours * 6 + 1 }, (_, i) => ({
    time: new Date(t0 + i * 10 * M),
    level: level(i / 6),
  }));
  const extremes: Extreme[] = [];
  for (let h = 3; h < hours; h += 6) {
    const high = h % 12 === 3;
    extremes.push({ time: new Date(t0 + h * H), level: level(h), high, low: !high, label: "" });
  }
  return { timeline, extremes };
}

export function tide(props: Partial<TideScrubberProps> = {}) {
  return (
    <TideScrubber
      {...tides()}
      timezone="UTC"
      latitude={50}
      longitude={0}
      units="meters"
      locale="en-US"
      {...props}
    />
  );
}

/** Four days of a 12-hour sine current, with its slacks and maxima. */
function currents() {
  const timeline = Array.from({ length: 577 }, (_, i) => ({
    time: new Date(t0 + i * 10 * M),
    speed: round(3 * Math.sin((2 * Math.PI * i) / 72)),
  }));
  const events: CurrentEvent[] = [];
  for (let h = 3; h < 96; h += 3) {
    const time = new Date(t0 + h * H);
    if (h % 12 === 3) events.push({ time, speed: 3, kind: "maxFlood", direction: 45 });
    else if (h % 12 === 9) events.push({ time, speed: -3, kind: "maxEbb", direction: 225 });
    else events.push({ time, speed: 0, kind: "slack" });
  }
  return { timeline, events };
}

export function current(selected?: number) {
  return (
    <CurrentScrubber
      {...currents()}
      timezone="UTC"
      latitude={50}
      longitude={0}
      directions={{ flood: 45 }}
      setFormat="compass"
      locale="en-US"
      selected={selected}
    />
  );
}

/** The strips `test/node-render.tsx` renders under Node, for the browser to hydrate. */
export const nodeRendered = {
  tide: () => tide(),
  selectedTide: () => tide({ selected: LATER }),
  selectedCurrent: () => current(NOW),
};
