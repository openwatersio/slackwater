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

/** Tolerance for root-finding: 1 second in hours */
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
 * Find the root of h'(t) in [a, b], where fa = h'(a) and fb = h'(b) have
 * opposite signs, to within TOLERANCE_HOURS.
 *
 * Illinois regula falsi: each step interpolates linearly between the bracket
 * ends and keeps the side whose sign differs. Halving the value at an end that
 * survives twice stops it from sticking, so both ends close in. It needs about
 * 4 evaluations of h' per root where bisection needs 12, and the root always
 * stays bracketed.
 */
function findRoot(
  a: number,
  b: number,
  fa: number,
  fb: number,
  params: ConstituentParam[],
): number {
  let kept = 0; // -1 when b was kept by the last step, 1 when a was
  for (;;) {
    const t = (a * fb - b * fa) / (fb - fa);
    if (b - a < TOLERANCE_HOURS) return t;

    const ft = evalHPrime(t, params);
    if (ft === 0) return t;

    if (fa > 0 ? ft > 0 : ft < 0) {
      a = t;
      fa = ft;
      if (kept === -1) fb /= 2;
      kept = -1;
    } else {
      b = t;
      fb = ft;
      if (kept === 1) fa /= 2;
      kept = 1;
    }
  }
}

/** Hours searched beyond each end of the window, just over a lunar day (24.84 h). */
const CONTEXT_HOURS = 25;

/**
 * Find tidal extremes in [fromHour, toHour] using derivative root-finding.
 *
 * Finds zeros of h'(t) by bracketing at intervals guaranteed to contain
 * at most one root, then narrowing each to sub-second precision. Extremes are
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
      const tRoot = findRoot(tPrev, tBound, dPrev, dNext, params);
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
  const n = extremes.length;
  const prev = Array.from({ length: n }, (_, i) => i - 1);
  const next = Array.from({ length: n }, (_, i) => i + 1);
  const alive = new Array<boolean>(n).fill(true);
  let count = n;

  // Min-heap of neighbour pairs [left, right], smallest change first and the earlier pair on a tie,
  // so removals happen in the same order as rescanning the whole list each time. A pair is stale
  // once either side is removed.
  const heap: [number, number, number][] = [];
  const before = (x: [number, number, number], y: [number, number, number]) =>
    x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  const push = (a: number, b: number) => {
    // The first and last extremes never pair for removal.
    if (a <= 0 || b >= n - 1) return;
    heap.push([Math.abs(extremes[b].level - extremes[a].level), a, b]);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!before(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  for (let i = 0; i + 1 < n; i++) push(i, i + 1);
  while (count > 3 && heap.length > 0) {
    const [change, a, b] = heap[0];
    if (!alive[a] || !alive[b]) {
      pop();
      continue;
    }
    if (change >= prominenceThreshold) break;
    pop();
    // Same-kind neighbours are one turn counted twice by the root finder; drop one copy.
    const last = extremes[a].high === extremes[b].high ? a : b;
    for (let i = a; i !== next[last]; i = next[i]) {
      alive[i] = false;
      count--;
    }
    const p = prev[a];
    const q = next[last];
    next[p] = q;
    prev[q] = p;
    push(p, q);
  }
  return extremes.filter((_, i) => alive[i]);
}
