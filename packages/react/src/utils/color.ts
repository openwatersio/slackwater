/** The magnitude ramp's anchors: current speed in knots, shared with the app. */
export const KNOT_ANCHORS = [0.5, 3, 8, 12];
/** Tide rate anchors in meters per hour; 1.8 m/hr (about 6 ft/hr) reaches the red. */
export const TIDE_RATE_ANCHORS = [0.6, 1.0, 1.5, 1.8];

const RAMP_STOPS: [number, number, number][] = [
  [0xf5, 0xc9, 0x6b],
  [0xf5, 0xc9, 0x6b],
  [0xe8, 0x76, 0x3c],
  [0xc9, 0x3a, 0x32],
];

const hex = (c: number[]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function rampRGB(value: number, anchors: number[]): number[] {
  const s = Math.abs(value);
  const i = anchors.findIndex((a) => s < a);
  if (i === 0) return RAMP_STOPS[0];
  if (i === -1) return RAMP_STOPS[RAMP_STOPS.length - 1];
  const f = (s - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
  return RAMP_STOPS[i - 1].map((c, k) => c + (RAMP_STOPS[i][k] - c) * f);
}

/**
 * The ramp color for an absolute magnitude against its anchors. The ramp is
 * the same at every station, never enters green, and clamps at both ends.
 */
export function rampColor(value: number, anchors: number[]): string {
  return hex(rampRGB(value, anchors));
}

/** The ramp moved `lift` of the way toward white. */
function liftedRamp(value: number, anchors: number[], lift: number): string {
  return hex(rampRGB(value, anchors).map((c) => Math.round(c + (255 - c) * lift)));
}

/** The ramp as text on the canvas: a quarter of the way to white clears 4.5:1 at every stop. */
export function rampInk(value: number, anchors: number[]): string {
  return liftedRamp(value, anchors, 0.25);
}

/** A current pin's fill: the knot ramp lifted 30% toward white, enough for the red end to clear 3:1 on the map's water. */
export function pinRampColor(knots: number): string {
  return liftedRamp(knots, KNOT_ANCHORS, 0.3);
}
