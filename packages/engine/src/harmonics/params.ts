import astro from "../astronomy/index.js";
import { d2r } from "../astronomy/constants.js";
import type { Constituent } from "../constituents/types.js";
import { iho, type Fundamentals } from "../node-corrections/index.js";
import type { ConstituentParam } from "./extremes.js";
import type { HarmonicConstituent } from "./prediction.js";

/** Recompute node corrections daily for long spans */
export const CORRECTION_INTERVAL_HOURS = 24;

export interface ParamsFactoryInput {
  /** Constituents with phases already converted to radians. */
  constituents: HarmonicConstituent[];
  constituentModels: Record<string, Constituent>;
  fundamentals?: Fundamentals;
  /** Instant corresponding to hour 0. */
  start: Date;
  /** Length of the prediction span in hours. */
  endHour: number;
}

/**
 * Build a factory of `getParams(hour)` functions: flat constituent parameters
 * with node corrections evaluated near the requested hour. Node corrections
 * vary on the 18.6-year nodal cycle and change by <0.01% per day, so they are
 * recomputed at CORRECTION_INTERVAL_HOURS and held constant between. Each call
 * to the factory returns a fresh stateful closure; the closure returns a new
 * array reference when corrections are recomputed, so callers can detect
 * changes via `!==`.
 */
export function createParamsFactory({
  constituents,
  constituentModels,
  fundamentals = iho,
  start,
  endHour,
}: ParamsFactoryInput): () => (hour: number) => ConstituentParam[] {
  const baseAstro = astro(start);
  const startMs = start.getTime();

  function prepareParams(correctionTime: Date): ConstituentParam[] {
    const correctionAstro = astro(correctionTime);
    const params: ConstituentParam[] = [];

    for (const constituent of constituents) {
      if (constituent.amplitude === 0) continue;

      const model = constituentModels[constituent.name];
      if (!model) continue;

      const V0 = d2r * model.value(baseAstro);
      const speed = d2r * model.speed;
      const correction = model.correction(correctionAstro, fundamentals);

      params.push({
        A: constituent.amplitude * correction.f,
        w: speed,
        phi: V0 + d2r * correction.u - constituent.phase,
      });
    }

    return params;
  }

  return function correctedParams(): (hour: number) => ConstituentParam[] {
    const firstChunkEnd = Math.min(CORRECTION_INTERVAL_HOURS, endHour);
    let params = prepareParams(new Date(startMs + (firstChunkEnd / 2) * 3600000));
    let nextCorrectionAt = CORRECTION_INTERVAL_HOURS;

    return (hour: number): ConstituentParam[] => {
      if (hour >= nextCorrectionAt) {
        const chunkEnd = Math.min(nextCorrectionAt + CORRECTION_INTERVAL_HOURS, endHour);
        params = prepareParams(new Date(startMs + ((nextCorrectionAt + chunkEnd) / 2) * 3600000));
        nextCorrectionAt += CORRECTION_INTERVAL_HOURS;
      }
      return params;
    };
  };
}
