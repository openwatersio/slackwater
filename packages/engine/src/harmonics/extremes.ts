/**
 * Precomputed constituent parameters with node corrections baked in.
 * Used for fast evaluation of h(t), h'(t), and h''(t).
 */
export interface ConstituentParam {
  A: number; // amplitude * f (effective amplitude)
  w: number; // speed in radians per hour
  phi: number; // V0 + u - phase (total phase offset in radians)
}

export interface Extreme {
  time: Date;
  level: number;
  high: boolean;
  low: boolean;
  label: string;
}

export interface FindExtremesOptions {
  /** Epoch milliseconds corresponding to hour=0 */
  startMs: number;
  /** Minimum prominence in metres for spurious extreme filtering */
  prominenceThreshold: number;
  /** Function returning constituent params with node corrections for a given hour */
  getParams: (hour: number) => ConstituentParam[];
}

/** Tolerance for bisection root-finding: 1 second in hours */
const TOLERANCE_HOURS = 1 / 3600;

/** Evaluate h(t) = Σ Aᵢ·cos(ωᵢ·t + φᵢ) */
export function evalH(t: number, params: ConstituentParam[]): number {
  let sum = 0;
  for (let i = 0; i < params.length; i++) {
    const { A, w, phi } = params[i];
    sum += A * Math.cos(w * t + phi);
  }
  return sum;
}

/** Evaluate h'(t) = -Σ Aᵢ·ωᵢ·sin(ωᵢ·t + φᵢ) */
function evalHPrime(t: number, params: ConstituentParam[]): number {
  let sum = 0;
  for (let i = 0; i < params.length; i++) {
    const { A, w, phi } = params[i];
    sum -= A * w * Math.sin(w * t + phi);
  }
  return sum;
}

/** Evaluate h''(t) = -Σ Aᵢ·ωᵢ²·cos(ωᵢ·t + φᵢ) */
function evalHDoublePrime(t: number, params: ConstituentParam[]): number {
  let sum = 0;
  for (let i = 0; i < params.length; i++) {
    const { A, w, phi } = params[i];
    sum -= A * w * w * Math.cos(w * t + phi);
  }
  return sum;
}

/**
 * Find root of h'(t) in [a, b] where h'(a) and h'(b) have opposite signs.
 * Uses bisection for guaranteed convergence to within TOLERANCE_HOURS.
 */
function bisect(a: number, b: number, fa: number, params: ConstituentParam[]): number {
  // Bisection halves the interval each iteration; convergence is guaranteed.
  // A 3-hour bracket reaches 1-second tolerance in ~13 iterations.
  while (true) {
    const mid = (a + b) / 2;
    if (b - a < TOLERANCE_HOURS) return mid;

    const fMid = evalHPrime(mid, params);
    if (fMid === 0) return mid;

    const sameSign = fa > 0 ? fMid > 0 : fMid < 0;
    if (sameSign) {
      a = mid;
      fa = fMid;
    } else {
      b = mid;
    }
  }
}

/** Hours searched beyond each end of the window, just over a lunar day (24.84 h). */
const CONTEXT_HOURS = 25;

/**
 * Find tidal extremes in [fromHour, toHour] using derivative root-finding.
 *
 * Finds zeros of h'(t) by bracketing at intervals guaranteed to contain
 * at most one root, then bisecting to sub-second precision. Extremes are
 * classified via the sign of h''(t), and spurious ones are removed by
 * filterExtremes. The search runs CONTEXT_HOURS past each end of the window
 * so every extreme in the window is filtered against its real neighbours,
 * then the result is cropped to the window.
 *
 * Since h(t) is a sum of cosines, it is valid for any t — including
 * hours before 0 or beyond endHour.
 */
export function findExtremes(
  fromHour: number,
  toHour: number,
  { startMs, prominenceThreshold, getParams }: FindExtremesOptions,
): Extreme[] {
  const results: Extreme[] = [];
  let params = getParams(Math.max(0, fromHour));

  if (params.length === 0) return results;

  // Bracket size: quarter-wavelength of the fastest constituent.
  // h'(t) can have at most one zero-crossing per quarter-period.
  let maxSpeed = 0;
  for (const { w } of params) {
    if (w > maxSpeed) maxSpeed = w;
  }
  // Z0 (mean water level offset) has speed=0: it shifts levels but h'(t)=0,
  // so it doesn't affect extreme timing. If it's the only constituent, no extremes exist.
  if (maxSpeed === 0) return results;

  const bracket = Math.PI / (2 * maxSpeed);
  // Whole brackets keep the bracket boundaries inside the window where they would be without context.
  // ponytail: a sub-threshold run longer than the context can still filter differently from a longer search
  const context = Math.ceil(CONTEXT_HOURS / bracket) * bracket;
  const searchTo = toHour + context;

  let tPrev = fromHour - context;
  let dPrev = evalHPrime(tPrev, params);

  for (let tNext = tPrev + bracket; tNext <= searchTo + bracket; tNext += bracket) {
    // Recompute node corrections for long spans
    const newParams = getParams(tPrev);
    if (newParams !== params) {
      params = newParams;
      dPrev = evalHPrime(tPrev, params);
    }

    const tBound = Math.min(tNext, searchTo);
    const dNext = evalHPrime(tBound, params);

    const signChanged = dPrev !== 0 && dNext !== 0 && (dPrev > 0 ? dNext < 0 : dNext > 0);
    if (signChanged) {
      const tRoot = bisect(tPrev, tBound, dPrev, params);
      const isHigh = evalHDoublePrime(tRoot, params) < 0;

      results.push({
        time: new Date(startMs + tRoot * 60 * 60 * 1000),
        level: evalH(tRoot, params),
        high: isHigh,
        low: !isHigh,
        label: isHigh ? "High" : "Low",
      });
    }

    if (tBound >= searchTo) break;
    tPrev = tBound;
    dPrev = dNext;
  }

  const fromMs = startMs + fromHour * 3600000;
  const toMs = startMs + toHour * 3600000;
  return filterExtremes(results, prominenceThreshold).filter(
    ({ time }) => time.getTime() >= fromMs && time.getTime() <= toMs,
  );
}

/**
 * Remove spurious extremes, smallest first: while two neighbours differ by less
 * than prominenceThreshold (metres), drop both, as NOAA CO-OPS drops successive
 * high and low tides closer than its 0.030 m (Water Level Station Specifications,
 * 2009, §1.3.2). Removing a low together with its high keeps highs and lows
 * alternating. The first and last extremes are never removed: their other
 * neighbour lies outside the list, so there is nothing to judge them against.
 */
export function filterExtremes(extremes: Extreme[], prominenceThreshold: number): Extreme[] {
  const kept = extremes.slice();
  const change = (i: number) => Math.abs(kept[i + 1].level - kept[i].level);
  // ponytail: O(n²) rescan per removal; a heap keyed on change() if long sub-threshold spans get slow
  while (kept.length > 3) {
    let worst = 1;
    for (let i = 2; i < kept.length - 2; i++) {
      if (change(i) < change(worst)) worst = i;
    }
    if (change(worst) >= prominenceThreshold) break;
    // Same-kind neighbours are one turn counted twice by the root finder; drop one copy.
    kept.splice(worst, kept[worst].high === kept[worst + 1].high ? 1 : 2);
  }
  return kept;
}
