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

/**
 * Find tidal extremes in [fromHour, toHour] using derivative root-finding.
 *
 * Finds zeros of h'(t) by bracketing at intervals guaranteed to contain
 * at most one root, then bisecting to sub-second precision. Extremes are
 * classified via the sign of h''(t), and spurious ones are removed by
 * filterExtremes.
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

  let tPrev = fromHour;
  let dPrev = evalHPrime(tPrev, params);

  for (let tNext = tPrev + bracket; tNext <= toHour + bracket; tNext += bracket) {
    // Recompute node corrections for long spans
    const newParams = getParams(tPrev);
    if (newParams !== params) {
      params = newParams;
      dPrev = evalHPrime(tPrev, params);
    }

    const tBound = Math.min(tNext, toHour);
    const dNext = evalHPrime(tBound, params);

    const signChanged = dPrev !== 0 && dNext !== 0 && (dPrev > 0 ? dNext < 0 : dNext > 0);
    if (signChanged) {
      const tRoot = bisect(tPrev, tBound, dPrev, params);

      if (tRoot >= fromHour && tRoot <= toHour) {
        const isHigh = evalHDoublePrime(tRoot, params) < 0;

        results.push({
          time: new Date(startMs + tRoot * 60 * 60 * 1000),
          level: evalH(tRoot, params),
          high: isHigh,
          low: !isHigh,
          label: isHigh ? "High" : "Low",
        });
      }
    }

    if (tBound >= toHour) break;
    tPrev = tBound;
    dPrev = dNext;
  }

  return filterExtremes(results, prominenceThreshold);
}

/**
 * Remove spurious extremes, smallest first: while two neighbours differ by less
 * than prominenceThreshold (metres), drop both, as NOAA CO-OPS drops successive
 * high and low tides closer than its 0.030 m (Water Level Station Specifications,
 * 2009, §1.3.2). Removing a low together with its high keeps highs and lows
 * alternating. Two or fewer extremes are returned as they are.
 */
export function filterExtremes(extremes: Extreme[], prominenceThreshold: number): Extreme[] {
  const kept = extremes.slice();
  const change = (i: number) => Math.abs(kept[i + 1].level - kept[i].level);
  // ponytail: O(n²) rescan per removal; a heap keyed on change() if long sub-threshold spans get slow
  while (kept.length > 2) {
    let worst = 0;
    for (let i = 1; i < kept.length - 1; i++) {
      if (change(i) < change(worst)) worst = i;
    }
    if (change(worst) >= prominenceThreshold) break;
    // Same-kind neighbours are one turn counted twice by the root finder; drop one copy.
    kept.splice(worst, kept[worst].high === kept[worst + 1].high ? 1 : 2);
  }
  return kept;
}
