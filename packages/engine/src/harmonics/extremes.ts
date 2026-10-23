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
  /**
   * Constituent params anchored at `start`, as a function of hours from it,
   * with node corrections. Each UTC day is searched from its own midnight.
   */
  paramsFrom: (start: Date) => (hour: number) => ConstituentParam[];
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

/** A slack instant: a value-zero of the harmonic sum h(t). */
export interface Slack {
  time: Date;
  /** Residual signed speed at the bisected root — within tolerance of zero. */
  speed: number;
}

export interface FindSlacksOptions {
  /** Epoch milliseconds corresponding to hour=0 */
  startMs: number;
  /** Function returning constituent params with node corrections for a given hour */
  getParams: (hour: number) => ConstituentParam[];
}

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
 * The furthest the filter looks from an extreme for what decides it: past the
 * fortnightly (MSf, 14.8 d) and monthly (MM, 27.6 d) cycles that set the
 * extremes of a tide whose daily turns are all below the threshold.
 */
const MAX_CONTEXT_DAYS = 32;
/**
 * How far the search goes for an extreme's nearest turn, however far away:
 * past a year, so a tide made of the annual and semiannual cycles alone still
 * has its neighbours.
 */
const MAX_LOOKAHEAD_DAYS = 400;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Find tidal extremes in [fromHour, toHour] using derivative root-finding.
 *
 * Turning points are the roots of h'(t), found in whole UTC days, each day
 * searched from its own midnight with its own brackets and node corrections,
 * so the turning points of any instant are the same whichever window asks.
 * Each day's first bracket opens on the previous day's h' at midnight, so a
 * turn the two days' parameters put on either side of midnight is found once.
 * Spurious ones are removed by their persistence (see filterExtremes), judged
 * from the turning points around each extreme, never the window's edges.
 * Days beyond the window are searched only while an extreme is undecided. The
 * extremes of any window are therefore exactly the extremes of a longer window
 * that fall inside it (#436). A threshold of zero keeps every turning point.
 */
export function findExtremes(
  fromHour: number,
  toHour: number,
  { startMs, prominenceThreshold, paramsFrom }: FindExtremesOptions,
): Extreme[] {
  const fromMs = startMs + fromHour * HOUR_MS;
  const toMs = startMs + toHour * HOUR_MS;
  const firstDay = Math.floor(fromMs / DAY_MS);
  // Each day keeps only its h' at midnight, for the day after it, and the
  // last parameters built are kept for the day that needs them next.
  const closingSlopes = new Map<number, number>();
  let lastDay = NaN;
  let lastParams: ConstituentParam[] = [];
  const paramsOf = (day: number) => {
    if (day !== lastDay) {
      lastParams = paramsFrom(new Date(day * DAY_MS))(0);
      lastDay = day;
      closingSlopes.set(day, evalHPrime(24, lastParams));
    }
    return lastParams;
  };
  const closingSlope = (day: number) => {
    if (!closingSlopes.has(day)) paramsOf(day);
    return closingSlopes.get(day)!;
  };
  // The day's own parameters come first, so the day before's, built for its
  // closing slope, are still kept when a backward scan reaches it next.
  const dayTurns = (day: number) => {
    const params = paramsOf(day);
    return turningPoints(day * DAY_MS, params, closingSlope(day - 1));
  };
  // Z0 alone has no turning points on any day; don't search a year of days to find that out.
  if (!paramsOf(firstDay).some(({ w }) => w > 0)) return [];

  // Turning points as one sequence indexed from the first turn of firstDay:
  // `after` holds index 0 onward, `before` holds index -1 backward. Days are
  // added at either end as a scan reaches them.
  const after: Extreme[] = [];
  const before: Extreme[] = [];
  let nextDay = firstDay;
  let prevDay = firstDay - 1;
  const lastSearchDay = Math.floor(toMs / DAY_MS) + MAX_LOOKAHEAD_DAYS;
  const firstSearchDay = firstDay - MAX_LOOKAHEAD_DAYS;
  const turn = (k: number): Extreme | undefined => {
    if (k >= 0) {
      while (after.length <= k && nextDay <= lastSearchDay) after.push(...dayTurns(nextDay++));
      return after[k];
    }
    while (before.length < -k && prevDay >= firstSearchDay)
      before.push(...dayTurns(prevDay--).reverse());
    return before[-k - 1];
  };

  const results: Extreme[] = [];
  for (let k = 0; ; k++) {
    const extreme = turn(k);
    if (!extreme || extreme.time.getTime() > toMs) break;
    // A threshold of zero keeps every turning point, unfiltered.
    if (
      extreme.time.getTime() >= fromMs &&
      (prominenceThreshold <= 0 || persists(turn, k, prominenceThreshold))
    ) {
      results.push(extreme);
    }
  }
  return results;
}

/**
 * Every root of h'(t) in the UTC day starting at dayStartMs, with `params`
 * anchored at its midnight. Node corrections refresh every 24 hours, so one
 * set holds for the whole day. Brackets are a quarter period of the fastest
 * constituent, within which h' is taken to change sign at most once; a root
 * exactly on a bracket boundary is not guaranteed. The first bracket opens on
 * `openingSlope`, the previous day's h' at midnight, so a sign change between
 * the two days' parameters is a turn at midnight, and a turn the previous day
 * already found just before midnight is not found again.
 */
function turningPoints(
  dayStartMs: number,
  params: ConstituentParam[],
  openingSlope: number,
): Extreme[] {
  const results: Extreme[] = [];
  let maxSpeed = 0;
  for (const { w } of params) {
    if (w > maxSpeed) maxSpeed = w;
  }
  // findExtremes returns early for Z0 alone, so some constituent has speed.
  const bracket = Math.PI / (2 * maxSpeed);
  let tPrev = 0;
  let dPrev = openingSlope;

  for (let tNext = bracket; ; tNext += bracket) {
    const tBound = Math.min(tNext, 24);
    const dNext = evalHPrime(tBound, params);

    const signChanged = dPrev !== 0 && dNext !== 0 && (dPrev > 0 ? dNext < 0 : dNext > 0);
    if (signChanged) {
      // The sign changed inside this day, so the root is this day's even where
      // rounding puts it a hair past 24 h: the next day opens on the slope
      // after it and won't find it again.
      const tRoot = Math.min(findRoot(tPrev, tBound, dPrev, dNext, params), 24);
      const isHigh = evalHDoublePrime(tRoot, params) < 0;
      results.push({
        time: new Date(dayStartMs + tRoot * HOUR_MS),
        level: evalH(tRoot, params),
        high: isHigh,
        low: !isHigh,
        label: isHigh ? "High" : "Low",
      });
    }

    if (tBound >= 24) break;
    tPrev = tBound;
    dPrev = dNext;
  }
  return results;
}

/**
 * Whether the extreme at index k persists: a high survives when, in each
 * direction, the tide falls at least prominenceThreshold (metres) below it
 * before rising above it; a low, mirrored. Away from a list's ends and exact
 * ties, that keeps what removing the closest high-low pair below the
 * threshold, smallest first, keeps, as
 * NOAA CO-OPS drops successive high and low tides closer than its 0.030 m
 * (Water Level Station Specifications, 2009, §1.3.2), but each extreme is
 * decided from its own neighbourhood, so the result does not depend on where a
 * search starts or ends. Of two equal turns in a row one survives.
 *
 * The nearest turn on each side always counts, however far away. Past it, the
 * scan stops MAX_CONTEXT_DAYS from the extreme, and an extreme still undecided
 * there, or at the end of the sequence, is dropped. Where every turn for more
 * than MAX_CONTEXT_DAYS is below the threshold, that can drop one extreme of
 * a high-low pair and leave two of a kind in a row.
 */
function persists(
  turn: (k: number) => Extreme | undefined,
  k: number,
  prominenceThreshold: number,
): boolean {
  const extreme = turn(k)!;
  const sign = extreme.high ? 1 : -1;
  const h = extreme.level * sign;
  const t = extreme.time.getTime();
  for (const dir of [-1, 1]) {
    let decided = false;
    for (let j = k + dir; ; j += dir) {
      const other = turn(j);
      // The nearest turn counts up to MAX_LOOKAHEAD_DAYS away; past it the scan
      // stops MAX_CONTEXT_DAYS from the extreme. Both are measured from the
      // extreme, never the window, so every window decides it alike.
      const limit = j === k + dir ? MAX_LOOKAHEAD_DAYS : MAX_CONTEXT_DAYS;
      if (!other || Math.abs(other.time.getTime() - t) > limit * DAY_MS) break;
      const v = other.level * sign;
      // An equal turn counts as higher on the left only, so one of two equal copies survives.
      if (dir < 0 ? v >= h : v > h) break;
      if (h - v >= prominenceThreshold) {
        decided = true;
        break;
      }
    }
    if (!decided) return false;
  }
  return true;
}

/** The extremes of a list that persist (see `persists`), judged within the list. */
export function filterExtremes(extremes: Extreme[], prominenceThreshold: number): Extreme[] {
  const turn = (k: number) => extremes[k];
  return extremes.filter((_, k) => persists(turn, k, prominenceThreshold));
}
