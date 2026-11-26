import {
  constituents as catalog,
  createTidePredictor,
  type Extreme,
  type TidePredictionOptions,
  type HarmonicConstituent,
} from "@slackwater/engine";
import { resolveConstituents } from "./constituents.js";
import { theoreticalLowestTide } from "./tlt.js";

export interface EpochSpec {
  end?: Date;
}

/** A single water-level point. `Extreme` from the predictor is assignable to this. */
export interface Sample {
  time: Date;
  level: number;
}

export type Datums = Record<string, number>;
export type DatumPredictionOptions = Omit<TidePredictionOptions, "prominenceThreshold">;

/**
 * The tide model's options for the observed reduction, which predicts only to
 * fill gaps: the nodal corrections the constants were fitted under (with
 * `latitude` for Foreman's) and any constituent definitions they need.
 */
export type DatumModelOptions = Pick<
  TidePredictionOptions,
  "nodeCorrections" | "latitude" | "definitions"
>;

export interface TidalDatumsResult {
  start: Date;
  /** Exclusive: the instant after the period's last hour. */
  end: Date;
  datums: Datums;
  /** Constituent names the engine doesn't know, left out of every calculation. */
  ignoredConstituents: string[];
}

/** One full lunar nodal cycle (6798.383 days = 18.6130 years) */
export const NODAL_CYCLE_DAYS = 6798.383;
/** M2 angular speed (°/hr) — principal lunar semi-diurnal constituent */
export const M2_SPEED = catalog["M2"]!.speed;
/** Mean tidal day: two M2 cycles (hours) */
const M2_TIDAL_DAY_HOURS = (360 / M2_SPEED) * 2;
export const TIDAL_DAY_MS = M2_TIDAL_DAY_HOURS * 60 * 60 * 1000;

/**
 * Pinned datum epoch: 19 full calendar years (2007–2025), the smallest
 * calendar-aligned window containing one 18.61-year lunar nodal cycle.
 *
 * Pinned (never derived from the current date) so regeneration is
 * deterministic — data diffs only ever reflect logic changes. 19 *full* years
 * rather than `now − 18.61y` because: partial years bias annual statistics
 * (LLWLT averages *annual* lowest lows, so a partial year's minimum is drawn
 * from fewer candidates and sits high); a fractional window over-samples the
 * seasons in its 0.61-year tail, skewing every mean datum; and 19 years ≈ the
 * Metonic cycle, so spring/neap phases distribute evenly across the seasons.
 * Same convention as NOAA's National Tidal Datum Epoch and CHS (both 19 y).
 * Bump deliberately (and regenerate the data) — roughly once a decade.
 */
export const DATUM_EPOCH: { readonly start: Date; readonly end: Date } = Object.freeze({
  // Getters, so changing a returned date can't move the pinned epoch.
  get start() {
    return new Date("2007-01-01T00:00:00Z");
  },
  get end() {
    return new Date("2026-01-01T00:00:00Z");
  },
});

const EPOCH_YEARS = 19;

/**
 * Resolve an EpochSpec to explicit start/end Dates.
 *
 * With no `end`, returns the pinned DATUM_EPOCH. With an explicit `end` (e.g.
 * windowing an observation record that stops before the pinned epoch), uses the
 * 19 years ending at `end` — never less than a full nodal cycle, since shorter
 * spans miss the full range of lunar node variation.
 */
export function resolveEpoch({ end }: EpochSpec): {
  start: Date;
  end: Date;
} {
  if (end && !Number.isFinite(+end)) throw new RangeError("invalidEpoch: end is not a valid date");
  if (!end) return { start: DATUM_EPOCH.start, end: DATUM_EPOCH.end };
  return { start: yearsBefore(end, EPOCH_YEARS), end: new Date(end) };
}

/** The same instant `years` earlier, with 29 February falling on the 28th of a common year. */
function yearsBefore(date: Date, years: number): Date {
  const year = date.getUTCFullYear() - years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const start = new Date(date);
  start.setUTCFullYear(year, month, Math.min(date.getUTCDate(), lastDay));
  return start;
}

/**
 * Means of a predicted tide's turning points over [start, end), before rounding, in the
 * constants' frame (MSL = 0). MHW and MLW average every high and low on a complete tidal day,
 * MHHW and MLLW one per complete day. LLWLT and HHWLT follow the Canadian Tidal Manual §5.7:
 * the mean of each calendar year's lowest low or highest high, over complete years only.
 */
function harmonicMeans(extremes: Extreme[], start: Date, end: Date): Datums {
  const allHighs: number[] = [];
  const allLows: number[] = [];
  const higherHighs: number[] = [];
  const lowerLows: number[] = [];
  const lowestLowByYear = new Map<number, number>();
  const highestHighByYear = new Map<number, number>();

  const times = extremes.map((pt) => pt.time);
  const heights = extremes.map((pt) => pt.level);

  if (times.length === 0) {
    throw new Error("times array is empty");
  }
  const firstTime = times[0]!;
  const lastTime = times[times.length - 1]!;

  let dayStartTime = firstTime.getTime();
  let idx = 0;

  while (dayStartTime < lastTime.getTime()) {
    const dayEndTime = dayStartTime + TIDAL_DAY_MS;

    const idxStart = idx;
    while (idx < times.length && times[idx]!.getTime() < dayEndTime) {
      idx++;
    }
    const idxEnd = idx;

    if (idxEnd > idxStart) {
      const highs: number[] = [];
      const lows: number[] = [];
      // Incomplete days can hide the higher high or lower low.
      const completeDay = idxStart > 0 && idxEnd < times.length;

      for (let i = idxStart; i < idxEnd; i++) {
        const { high, level: hCurr } = extremes[i]!;
        const year = times[i]!.getUTCFullYear();
        if (high) {
          highs.push(hCurr);
          if (hCurr > (highestHighByYear.get(year) ?? -Infinity))
            highestHighByYear.set(year, hCurr);
        } else {
          lows.push(hCurr);
          if (hCurr < (lowestLowByYear.get(year) ?? Infinity)) lowestLowByYear.set(year, hCurr);
        }
      }

      if (completeDay && highs.length > 0) {
        allHighs.push(...highs);
        higherHighs.push(max(highs));
      }

      if (completeDay && lows.length > 0) {
        allLows.push(...lows);
        lowerLows.push(min(lows));
      }
    }

    // The inner loop already left idx at the first point of the next day.
    dayStartTime = dayEndTime;
  }

  const years = completeYears(start, end);
  const mhw = mean(allHighs);
  const mlw = mean(allLows);

  return {
    // max/min loop instead of Math.max(...heights): long series overflow the call stack.
    HAT: max(heights),
    HHWLT: mean(years.map((year) => highestHighByYear.get(year)!)),
    MHHW: mean(higherHighs),
    MHW: mhw,
    MSL: 0,
    MTL: (mhw + mlw) / 2,
    MLW: mlw,
    MLLW: mean(lowerLows),
    LLWLT: mean(years.map((year) => lowestLowByYear.get(year)!)),
    LAT: min(heights),
  };
}

/** The calendar years that lie wholly inside [start, end). */
function completeYears(start: Date, end: Date): number[] {
  const years: number[] = [];
  const first =
    start.getTime() === Date.UTC(start.getUTCFullYear(), 0, 1)
      ? start.getUTCFullYear()
      : start.getUTCFullYear() + 1;
  for (let year = first; Date.UTC(year + 1, 0, 1) <= end.getTime(); year++) years.push(year);
  return years;
}

/**
 * Amplitude-derived low/high datums, in the constituent frame (MSL = 0), for constituents
 * keyed by the engine's names. Omitted without M2, where they would collapse to MSL.
 *
 * - MHWS/MLWS: Mean High/Low Water Springs, the Admiralty approximation MSL ± (H_M2 + H_S2).
 * - ISLW: Indian Spring Low Water, MSL − (H_M2 + H_S2 + H_K1 + H_O1). Stored under the
 *   national labels NLLW (Japan, "Nearly Lowest Low Water") and ALLW (South Korea,
 *   "Approximate Lowest Low Water"), which share this definition.
 */
function amplitudeDatums(find: (name: string) => HarmonicConstituent | undefined): Datums {
  if (!find("M2")) return {};
  const a = (name: string) => find(name)?.amplitude ?? 0;
  const springs = a("M2") + a("S2");
  const islw = springs + a("K1") + a("O1");
  return { MHWS: springs, MLWS: -springs, NLLW: -islw, ALLW: -islw };
}

/**
 * Use @slackwater/engine to synthesize a multi-year tidal timeline
 * for a given set of constituents, and compute tidal datums from it.
 *
 * Every datum is relative to MSL, or to the gauge zero when `offset` gives MSL's height above
 * it. Constituent names the engine doesn't know are left out and listed in the result.
 */
export function computeDatums(
  constituents: HarmonicConstituent[],
  epochSpec: EpochSpec = {},
  tidePredictorOptions: DatumPredictionOptions = {},
): TidalDatumsResult {
  const { start, end } = resolveEpoch(epochSpec);
  const { offset, ...options } = tidePredictorOptions;
  if (typeof offset === "number" && !Number.isFinite(offset))
    throw new RangeError("invalidOffset: offset must be finite");
  const { ignored, duplicates, find } = resolveConstituents(constituents, options.definitions);
  // The engine would add both waves while an amplitude formula can read only one.
  if (duplicates.length) throw new RangeError(`duplicateConstituent: ${duplicates.join(", ")}`);
  // A Z0 constant is a datum offset, not a tide: shift every datum by it, like `offset`.
  const z0 = find("Z0");
  const tide = constituents.filter((constituent) => constituent !== z0);

  // The engine gets the constants as given, so it refuses what it refuses. A display
  // prominence threshold selects highs and lows by amplitude and biases their means.
  const extremes = createTidePredictor(tide, {
    ...options,
    offset: false,
    prominenceThreshold: 0,
  })
    .getExtremesPrediction({ start, end })
    // The engine widens a search to its 10-minute grid; keep only the epoch's own turns.
    .filter((extreme) => extreme.time >= start && extreme.time < end);

  const datums: Datums = { ...harmonicMeans(extremes, start, end), ...amplitudeDatums(find) };
  const tlt = theoreticalLowestTide(find);
  if (tlt !== undefined) datums["TLT"] = tlt;

  // Shift every datum by the same amount, so the map stays in one frame.
  const shift =
    (typeof offset === "number" ? offset : 0) +
    (z0 ? z0.amplitude * Math.cos((z0.phase * Math.PI) / 180) : 0);
  return {
    start,
    end,
    datums: rounded(datums, shift),
    ignoredConstituents: ignored,
  };
}

/** Round to the millimetre after `shift`, dropping any datum that came out non-finite. */
export function rounded(datums: Datums, shift = 0): Datums {
  const result: Datums = {};
  for (const [key, value] of Object.entries(datums)) {
    const height = toFixed(value + shift, 3);
    if (Number.isFinite(height)) result[key] = height;
  }
  return result;
}

export function toFixed(num: number, digits: number) {
  if (typeof num !== "number") return num;

  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN;
}

/** Loop-based min/max — avoids the call-stack overflow of Math.min/max(...arr) on large arrays. */
export function max(arr: number[]): number {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  return m;
}

export function min(arr: number[]): number {
  let m = Infinity;
  for (const v of arr) if (v < m) m = v;
  return m;
}
