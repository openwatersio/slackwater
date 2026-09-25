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
  /** Whether station exhibits double tides (disables temporal gap filter) */
  isDoubleTide: boolean;
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

/** A slack instant: a value-zero of the harmonic sum h(t). */
export interface Slack {
  time: Date;
  /** Residual signed speed at the bisected root — within tolerance of zero. */
  speed: number;
}

export type FindSlacksOptions = Pick<FindExtremesOptions, "startMs" | "getParams">;

/**
 * Find root of h(t) in [a, b] where h(a) and h(b) have opposite signs.
 * Same bisection as `bisect`, on the value rather than the derivative.
 */
function bisectZero(a: number, b: number, fa: number, params: ConstituentParam[]): number {
  while (true) {
    const mid = (a + b) / 2;
    if (b - a < TOLERANCE_HOURS) return mid;

    const fMid = evalH(mid, params);
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
 * Find slack instants (value-zeros of h(t)) in [fromHour, toHour].
 *
 * Mirrors the bracket-and-bisect structure of findExtremes — the same
 * quarter-period bracket of the fastest constituent guarantees at most one
 * zero-crossing per step — but roots h(t) itself instead of h'(t). No
 * prominence or temporal-gap filtering: every sign change is a real reversal.
 */
export function findSlacks(
  fromHour: number,
  toHour: number,
  { startMs, getParams }: FindSlacksOptions,
): Slack[] {
  const results: Slack[] = [];
  let params = getParams(Math.max(0, fromHour));

  if (params.length === 0) return results;

  let maxSpeed = 0;
  for (const { w } of params) {
    if (w > maxSpeed) maxSpeed = w;
  }
  // Z0 alone is a constant offset: no zero-crossings to find.
  if (maxSpeed === 0) return results;

  const bracket = Math.PI / (2 * maxSpeed);

  let tPrev = fromHour;
  let vPrev = evalH(tPrev, params);

  for (let tNext = tPrev + bracket; tNext <= toHour + bracket; tNext += bracket) {
    // Recompute node corrections for long spans
    const newParams = getParams(tPrev);
    if (newParams !== params) {
      params = newParams;
      vPrev = evalH(tPrev, params);
    }

    const tBound = Math.min(tNext, toHour);
    const vNext = evalH(tBound, params);

    // A root exactly on a bracket boundary is skipped, matching findExtremes
    // and the Swift port: emitting it from both adjacent brackets would
    // duplicate it, an exact float zero of a real constituent sum does not
    // occur, and CONTRACT.md documents boundary roots as not guaranteed.
    const signChanged = vPrev !== 0 && vNext !== 0 && (vPrev > 0 ? vNext < 0 : vNext > 0);
    if (signChanged) {
      const tRoot = bisectZero(tPrev, tBound, vPrev, params);

      if (tRoot >= fromHour && tRoot <= toHour) {
        results.push({
          time: new Date(startMs + tRoot * 60 * 60 * 1000),
          speed: evalH(tRoot, params),
        });
      }
    }

    if (tBound >= toHour) break;
    tPrev = tBound;
    vPrev = vNext;
  }

  return results;
}

/**
 * Find tidal extremes in [fromHour, toHour] using derivative root-finding.
 *
 * Finds zeros of h'(t) by bracketing at intervals guaranteed to contain
 * at most one root, then bisecting to sub-second precision. Extremes are
 * classified via the sign of h''(t). Spurious extremes are filtered using
 * two criteria (modelled on Hatyan / NOAA CO-OPS practice):
 *   1. Absolute prominence floor (prominenceThreshold, metres): extremes
 *      whose min level change to either neighbor is below this threshold are
 *      removed (Hatyan default 0.01 m; NOAA CO-OPS 0.03 m).
 *   2. Minimum temporal gap: same-type adjacent extremes (H–H or L–L)
 *      closer in time than dominantPeriod / (2 × 1.85) are candidates for
 *      removal, where dominantPeriod is the highest-amplitude constituent in
 *      the main tidal band (1–30 h). Disabled for double-tide stations
 *      (Doodson criterion: (M4 + MS4) / M2 > 0.25) to preserve aggers.
 * Greedy iterative removal (least-prominent first) handles clusters correctly.
 *
 * Since h(t) is a sum of cosines, it is valid for any t — including
 * hours before 0 or beyond endHour.
 */
export function findExtremes(
  fromHour: number,
  toHour: number,
  { startMs, isDoubleTide, prominenceThreshold, getParams }: FindExtremesOptions,
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

  // Dominant tidal constituent: highest amplitude in the main tidal band (1–30 h).
  // Used to set the minimum temporal gap between adjacent extremes.
  const TIDAL_MIN_W = Math.PI / 15; // 2π/30 h ≈ 0.209 rad/h
  const TIDAL_MAX_W = 2 * Math.PI; // 2π/1 h  ≈ 6.28  rad/h
  let dominantA = 0;
  let dominantW = 0;
  for (const { A, w } of params) {
    if (w >= TIDAL_MIN_W && w <= TIDAL_MAX_W && A > dominantA) {
      dominantA = A;
      dominantW = w;
    }
  }
  if (dominantW === 0) dominantW = maxSpeed;

  // Minimum gap between same-type adjacent extremes (H-H or L-L),
  // generalizing Hatyan's M2_period/1.85 criterion to the dominant
  // constituent using half the dominant period / 1.85.
  // Set to 0 for double-tide stations so genuine aggers are preserved.
  const minGapH = isDoubleTide ? 0 : Math.PI / (1.85 * dominantW);

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

  // Filter spurious extremes using two criteria (modelled on Hatyan / NOAA CO-OPS):
  //   1. Absolute prominence floor: prominence < prominenceThreshold (metres).
  //   2. Temporal gap: adjacent gap < minGapH (disabled for double-tide stations).
  // Greedy: remove the least-prominent offending interior extreme each iteration.
  // Uses prev/next index arrays (linked list over the results array) to avoid
  // O(n) splice shifts on each removal.
  const n = results.length;
  if (n > 2) {
    const prv = new Int32Array(n);
    const nxt = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      prv[i] = i - 1;
      nxt[i] = i + 1;
    }

    // Evaluate whether an interior element is spurious and its prominence.
    function evalProm(i: number): { prom: number; offending: boolean } {
      const p = prv[i],
        nx = nxt[i];
      if (p < 0 || nx >= n) return { prom: Infinity, offending: false };
      const left = Math.abs(results[i].level - results[p].level);
      const right = Math.abs(results[nx].level - results[i].level);
      const prom = Math.min(left, right);
      // Temporal gap applies only to same-type pairs (H-H or L-L), matching
      // Hatyan's same-type distance criterion. H-L transitions can be short
      // in mixed-semi regimes and are not physically spurious.
      const prevGapH = (results[i].time.getTime() - results[p].time.getTime()) / 3600000;
      const nextGapH = (results[nx].time.getTime() - results[i].time.getTime()) / 3600000;
      const tooClose =
        minGapH > 0 &&
        ((prevGapH < minGapH && results[i].high === results[p].high) ||
          (nextGapH < minGapH && results[i].high === results[nx].high));
      return { prom, offending: prom < prominenceThreshold || tooClose };
    }

    // Find the worst offending interior extreme
    function findWorst(): { idx: number; prom: number } {
      let worstIdx = -1;
      let worstProm = Infinity;
      for (let i = nxt[0]; nxt[i] < n; i = nxt[i]) {
        const { prom, offending } = evalProm(i);
        if (offending && prom < worstProm) {
          worstProm = prom;
          worstIdx = i;
        }
      }
      return { idx: worstIdx, prom: worstProm };
    }

    let worst = findWorst();
    while (worst.idx !== -1) {
      // Unlink the worst element
      const p = prv[worst.idx],
        nx = nxt[worst.idx];
      nxt[p] = nx;
      prv[nx] = p;
      worst = findWorst();
    }

    // Compact: collect surviving elements in linked-list order
    const filtered: Extreme[] = [];
    for (let i = 0; i < n; i = nxt[i]) {
      filtered.push(results[i]);
    }
    return filtered;
  }

  return results;
}
