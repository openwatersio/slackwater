import type { CurrentPoint } from "../currents.js";

/** `value` at `time`, linearly interpolated between sorted samples; undefined outside them. */
export function interpolate<T extends { time: Date }>(
  points: T[],
  time: Date,
  value: (p: T) => number,
): number | undefined {
  const at = time.getTime();
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || at < points[0].time.getTime() || at > points[hi].time.getTime()) {
    return undefined;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time.getTime() <= at) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.time.getTime() - a.time.getTime();
  return span === 0
    ? value(a)
    : value(a) + ((value(b) - value(a)) * (at - a.time.getTime())) / span;
}

/** Where the signed line from `a` to `b` meets ±`threshold`, on the side of whichever sample is outside the band. Exactly one of the two samples lies outside the band, so the two speeds differ. */
export function bandCrossing(
  a: Pick<CurrentPoint, "time" | "speed">,
  b: Pick<CurrentPoint, "time" | "speed">,
  threshold: number,
): Date {
  const outside = Math.abs(a.speed) > threshold ? a.speed : b.speed;
  const edge = outside > 0 ? threshold : -threshold;
  const start = a.time.getTime();
  return new Date(start + ((b.time.getTime() - start) * (edge - a.speed)) / (b.speed - a.speed));
}

/** Where `value` sits among `values`, 0…1, ties counting as below; undefined with fewer than two to rank against. */
export function peakRank(value: number, values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  return values.filter((v) => v <= value).length / values.length;
}
