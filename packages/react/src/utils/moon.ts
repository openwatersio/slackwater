import {
  ApsisKind,
  Body,
  Illumination,
  MoonPhase,
  NextLunarApsis,
  SearchLunarApsis,
} from "astronomy-engine";

const DAY = 86_400_000;
const SYNODIC_DAYS = 29.53;

export interface MoonState {
  /** Through the synodic month, 0…1: 0 new, 0.5 full. */
  phase: number;
  /** The lit fraction of the disc, 0…1. */
  fraction: number;
  waxing: boolean;
}

export function moonAt(time: number): MoonState {
  const phase = MoonPhase(new Date(time)) / 360;
  return {
    phase,
    fraction: Illumination(Body.Moon, new Date(time)).phase_fraction,
    waxing: phase < 0.5,
  };
}

/** The app's eight names: new and full hold 1.7 days either side, the quarters 1.4. */
export function moonPhaseName(phase: number): string {
  const age = phase * SYNODIC_DAYS;
  const waxing = age < SYNODIC_DAYS / 2;
  if (age < 1.7 || age > SYNODIC_DAYS - 1.7) return "New Moon";
  if (Math.abs(age - SYNODIC_DAYS / 2) < 1.7) return "Full Moon";
  if (Math.abs(age - SYNODIC_DAYS / 4) < 1.4) return "First Quarter";
  if (Math.abs(age - (3 * SYNODIC_DAYS) / 4) < 1.4) return "Last Quarter";
  const fraction = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_DAYS)) / 2;
  if (fraction < 0.5) return waxing ? "Waxing Crescent" : "Waning Crescent";
  return waxing ? "Waxing Gibbous" : "Waning Gibbous";
}

/** The perigee and apogee nearest `around` within fifteen days either side. */
export function moonApsides(around: number): { perigee?: number; apogee?: number } {
  const found: { perigee?: number; apogee?: number } = {};
  for (
    let apsis = SearchLunarApsis(new Date(around - 15 * DAY));
    apsis.time.date.getTime() <= around + 15 * DAY;
    apsis = NextLunarApsis(apsis)
  ) {
    const t = apsis.time.date.getTime();
    const key = apsis.kind === ApsisKind.Pericenter ? "perigee" : "apogee";
    const held = found[key];
    if (held === undefined || Math.abs(t - around) < Math.abs(held - around)) found[key] = t;
  }
  return found;
}

/** The range the Moon is driving: spring at new and full, neap at the quarters, perigean or apogean within two days of either. */
export function moonTideLabel(
  phase: number,
  at: number,
  perigee: number | undefined,
  apogee: number | undefined,
): string | undefined {
  const name = moonPhaseName(phase);
  const range =
    name === "New Moon" || name === "Full Moon"
      ? "spring"
      : name.endsWith("Quarter")
        ? "neap"
        : undefined;
  // Coastal tides can lag the astronomical event by a day or two.
  const near = (t: number | undefined) => t !== undefined && Math.abs(t - at) <= 2 * DAY;
  const apsis = near(perigee) ? "Perigean" : near(apogee) ? "Apogean" : undefined;
  if (apsis) return range ? `${apsis} ${range} tide` : `${apsis} tide`;
  if (range === "spring") return "Spring tide";
  if (range === "neap") return "Neap tide";
  return undefined;
}

/**
 * The lit region of a disc of radius `r` centered on the origin, lit from +x:
 * the right half, then back up the terminator, an ellipse whose width follows
 * the fraction lit.
 */
export function moonLitPath(fraction: number, r: number): string {
  const c = 2 * fraction - 1;
  const rx = r * Math.abs(c);
  return `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx} ${r} 0 0 ${c >= 0 ? 1 : 0} 0 ${-r}Z`;
}
