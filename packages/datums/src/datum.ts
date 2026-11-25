import {
  constituents as catalog,
  createTidePredictor,
  type TidePredictionOptions,
  type HarmonicConstituent,
} from "@slackwater/engine";
import { prepareDatumObservations, type PreparedDatumObservations } from "./observations.js";

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
  end: Date;
  datums: Datums;
}

/** One full lunar nodal cycle (6798.383 days = 18.6130 years) */
export const NODAL_CYCLE_DAYS = 6798.383;
/** M2 angular speed (°/hr) — principal lunar semi-diurnal constituent */
export const M2_SPEED = catalog["M2"]!.speed;
/** Mean tidal day: two M2 cycles (hours) */
const M2_TIDAL_DAY_HOURS = (360 / M2_SPEED) * 2;

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
export const DATUM_EPOCH = {
  start: new Date("2007-01-01T00:00:00Z"),
  end: new Date("2026-01-01T00:00:00Z"),
} as const;

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
  // Fresh dates, so a caller changing a result can't move the pinned epoch.
  if (!end) return { start: new Date(DATUM_EPOCH.start), end: new Date(DATUM_EPOCH.end) };
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - EPOCH_YEARS);
  return { start, end: new Date(end) };
}

/**
 * Core helper: given a regular timeline of {time, level}, compute datums.
 *
 * `msl` is the mean sea level to report (mean of all hourly heights, per NOAA
 * CO-OPS handbook §3.1). It only sets the returned MSL field; every other datum
 * stays in the input series' native frame. Synthetic (constituent) callers leave
 * it 0; observed callers pass the mean of the hourly series.
 */
function computeDatumsFromExtremes(extremes: Sample[], msl = 0): Datums {
  const allHighs: number[] = [];
  const allLows: number[] = [];
  const higherHighs: number[] = [];
  const lowerLows: number[] = [];
  // Lowest low water observed in each calendar year, keyed by UTC year. Averaged
  // into LLWLT (Canada's Lower Low Water, Large Tide — the mean of the annual
  // lowest low waters over the analysis period).
  const lowestLowByYear = new Map<number, number>();

  const tidalDayMs = M2_TIDAL_DAY_HOURS * 60 * 60 * 1000;
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
    const dayEndTime = dayStartTime + tidalDayMs;

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
        // The first and last points have no neighbour to compare with.
        if (i === 0 || i === heights.length - 1) continue;
        const hPrev = heights[i - 1]!;
        const hCurr = heights[i]!;
        const hNext = heights[i + 1]!;

        if (hCurr >= hPrev && hCurr >= hNext && (hCurr > hPrev || hCurr > hNext)) {
          highs.push(hCurr);
        } else if (hCurr <= hPrev && hCurr <= hNext && (hCurr < hPrev || hCurr < hNext)) {
          lows.push(hCurr);
          const yr = times[i]!.getUTCFullYear();
          const prevMin = lowestLowByYear.get(yr);
          if (prevMin === undefined || hCurr < prevMin) {
            lowestLowByYear.set(yr, hCurr);
          }
        }
      }

      if (completeDay && highs.length > 0) {
        allHighs.push(...highs);
        highs.sort((a, b) => a - b);
        higherHighs.push(highs[highs.length - 1]!);
      }

      if (completeDay && lows.length > 0) {
        allLows.push(...lows);
        lows.sort((a, b) => a - b);
        lowerLows.push(lows[0]!);
      }
    }

    // The inner loop already left idx at the first point of the next day.
    dayStartTime = dayEndTime;
  }

  const mhw = mean(allHighs);
  const mlw = mean(allLows);

  return {
    // max/min loop instead of Math.max(...heights): observed series have 100k+
    // points and the spread overflows the call stack.
    HAT: toFixed(max(heights), 3),
    MHHW: toFixed(mean(higherHighs), 3),
    MHW: toFixed(mhw, 3),
    // MSL = mean of hourly heights (NOAA CO-OPS handbook §3.1). 0 for synthetic
    // constituent series; the observed mean for real water-level series.
    MSL: toFixed(msl, 3),
    MTL: toFixed((mhw + mlw) / 2, 3),
    MLW: toFixed(mlw, 3),
    MLLW: toFixed(mean(lowerLows), 3),
    // LLWLT (Lower Low Water, Large Tide): mean of the annual lowest low waters. A series that
    // doesn't start in January averages partial years, whose minima sit high.
    LLWLT: toFixed(mean([...lowestLowByYear.values()]), 3),
    LAT: toFixed(min(heights), 3),
  };
}

/**
 * Amplitude-derived low/high datums, in the constituent frame (MSL = 0). These
 * are functions of the constituent amplitudes rather than the extremes series,
 * so the caller shifts them into the observed gauge frame the same way it does
 * HAT/LAT.
 *
 * - MHWS/MLWS: Mean High/Low Water Springs, the classic Admiralty approximation
 *   MSL ± (H_M2 + H_S2).
 * - ISLW: Indian Spring Low Water, MSL − (H_M2 + H_S2 + H_K1 + H_O1). Stored
 *   under the national labels NLLW (Japan, "Nearly Lowest Low Water") and ALLW
 *   (South Korea, "Approximate Lowest Low Water"), which share this definition.
 * - TLT: China's Theoretical Lowest Tide (理论最低潮面 / theoretical depth
 *   datum). Approximated as the astronomical minimum of the tide predicted from
 *   the 13 constituents the Vladimirsky method uses. This is NOT the official
 *   Vladimirsky tabular calculation, so expect cm-level differences from
 *   published Chinese values — it captures the theoretical-lowest intent by
 *   restricting the constituent set relative to LAT.
 */
const TLT_CONSTITUENTS = new Set([
  "M2",
  "S2",
  "N2",
  "K2",
  "K1",
  "O1",
  "P1",
  "Q1",
  "M4",
  "MS4",
  "M6",
  "SA",
  "SSA",
]);

function amplitudeDatums(constituents: HarmonicConstituent[]): Datums {
  const amp = new Map<string, number>();
  for (const c of constituents) amp.set(c.name, c.amplitude);
  // Without M2 the approximations would collapse to MSL; omit them instead
  // (mirrors computeTLT returning undefined on an empty subset).
  if (!amp.has("M2")) return {};
  const a = (name: string) => amp.get(name) ?? 0;

  const springs = a("M2") + a("S2");
  const islw = a("M2") + a("S2") + a("K1") + a("O1");

  return {
    MHWS: toFixed(springs, 3),
    MLWS: toFixed(-springs, 3),
    // ISLW value, exposed under both national labels (same construct).
    NLLW: toFixed(-islw, 3),
    ALLW: toFixed(-islw, 3),
  };
}

function datumExtremes(
  constituents: HarmonicConstituent[],
  start: Date,
  end: Date,
  options: DatumPredictionOptions,
): Sample[] {
  // A display prominence threshold selects highs and lows by amplitude and biases their means.
  return createTidePredictor(constituents, {
    ...options,
    prominenceThreshold: 0,
  }).getExtremesPrediction({ start, end });
}

/**
 * China's Theoretical Lowest Tide, computed as the astronomical minimum of the
 * tide synthesized from the Vladimirsky 13-constituent subset over the epoch, in
 * the constituent frame (MSL = 0). Returns undefined when none of the subset
 * constituents are present.
 */
function computeTLT(
  constituents: HarmonicConstituent[],
  start: Date,
  end: Date,
  tidePredictorOptions: DatumPredictionOptions,
): number | undefined {
  const subset = constituents.filter((c) => TLT_CONSTITUENTS.has(c.name.toUpperCase()));
  if (subset.length === 0) return undefined;
  const extremes = datumExtremes(subset, start, end, tidePredictorOptions);
  if (extremes.length === 0) return undefined;
  return toFixed(min(extremes.map((e) => e.level)), 3);
}

/**
 * Use @slackwater/engine to synthesize a multi-year tidal timeline
 * for a given set of constituents, and compute tidal datums from it.
 */
export function computeDatums(
  constituents: HarmonicConstituent[],
  epochSpec: EpochSpec = {},
  tidePredictorOptions: DatumPredictionOptions = {},
): TidalDatumsResult {
  const { start, end } = resolveEpoch(epochSpec);

  const extremes = datumExtremes(constituents, start, end, tidePredictorOptions);

  const datums: Datums = {
    ...computeDatumsFromExtremes(extremes),
    ...amplitudeDatums(constituents),
  };
  const tlt = computeTLT(constituents, start, end, tidePredictorOptions);
  if (tlt !== undefined) datums["TLT"] = tlt;

  return { start, end, datums: finite(datums) };
}

/** Drop any datum that came out non-finite, so callers never store NaN. */
function finite(datums: Datums): Datums {
  for (const [key, value] of Object.entries(datums)) {
    if (!Number.isFinite(value)) delete datums[key];
  }
  return datums;
}

export interface ObservedTidalDatumsResult extends TidalDatumsResult {
  coverage: PreparedDatumObservations["coverage"];
}

/**
 * Derive tidal datums directly from observed water-level samples (NOAA CO-OPS
 * "first reduction", Computational Techniques for Tidal Datums Handbook §3.1).
 *
 * Reduces one continuous window of whole years after bounded
 * model-assisted gap reconstruction. This is a first reduction over the returned
 * period, without a control-station correction to the 19-year epoch. HAT/LAT
 * here are observed extremes; source importers use harmonic astronomical bounds.
 *
 * Returns null when the windowed record is too short/sparse to be meaningful.
 */
export function computeDatumsFromObservations(
  samples: Sample[],
  constituents: HarmonicConstituent[] = [],
  modelOptions: DatumModelOptions = {},
): ObservedTidalDatumsResult | null {
  const prepared = prepareDatumObservations(samples, constituents, modelOptions);
  if (!prepared) return null;
  const observedMSL = mean(prepared.samples.map((p) => p.level));
  const datums = computeDatumsFromExtremes(prepared.samples, observedMSL);
  if (!Number.isFinite(datums["MHW"]) || !Number.isFinite(datums["MLW"])) return null;

  return {
    start: prepared.start,
    end: prepared.end,
    datums: finite(datums),
    coverage: prepared.coverage,
  };
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
