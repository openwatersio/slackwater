import astro from "./astronomy/index.js";
import { constituentModels } from "./constituents/index.js";
import type { Constituent, ConstituentDefinition } from "./constituents/types.js";
import type { HarmonicConstituent } from "./harmonics/index.js";

export interface HarmonicSample {
  time: Date;
  value: number;
}

export interface FittedConstituent extends HarmonicConstituent {
  /** Half-width of the 95% confidence interval for `amplitude`, with `confidence`. */
  amplitudeInterval?: number;
  /** Half-width of the 95% confidence interval for `phase`, in degrees, with `confidence`. */
  phaseInterval?: number;
  /** Signal-to-noise ratio: amplitude squared over its variance, with `confidence`. */
  snr?: number;
}

export interface HarmonicFit {
  constituents: FittedConstituent[];
  offset: number;
  /** Root mean square residual, weighted by the weights of the final solve, robust weights included. */
  rms: number;
  unseparable: { constituents: [string, string]; requiredDays: number }[];
  /** Names left out with `dropDependent`, because the record can't tell them from names before them. */
  dropped: string[];
}

export interface FitOptions {
  /** Constituents to add to the catalog, or to replace catalog entries of the same name. */
  definitions?: readonly ConstituentDefinition[];
  /**
   * A nonnegative reliability weight for each sample, in sample order, scaling
   * its influence on the estimates. A zero weight leaves the sample out.
   */
  weights?: readonly number[];
  /**
   * Downweight outliers by iteratively reweighted least squares with Cauchy
   * weights, as UTide does by default (Codiga 2011, §II.B.1).
   */
  robust?: boolean;
  /**
   * Leave out a constituent the record can't separate from the names before
   * it, and list it in `dropped`, rather than throw `rankDeficient`. Pass
   * names in priority order, so the weaker of a pair is the one dropped.
   */
  dropDependent?: boolean;
  /**
   * Add 95% confidence intervals and SNR to each constituent, from the
   * residual spectrum in its frequency band (Pawlowicz, Beardsley and Lentz 2002).
   * Needs more weighted samples than fitted parameters.
   */
  confidence?: boolean;
}

const radians = Math.PI / 180;
// UTide's defaults for its Cauchy weight function and for stopping (robustfit.py).
const ROBUST_TUNE = 2.385;
const ROBUST_TOLERANCE = 0.001;
const ROBUST_ITERATIONS = 50;
// UTide's bands for the residual spectrum, in cycles per hour (periodogram.py).
const BANDS: readonly [number, number][] = [
  [0.0001, 0.00417],
  [0.03192, 0.04859],
  [0.07218, 0.08884],
  [0.11243, 0.1291],
  [0.15269, 0.16936],
  [0.19295, 0.20961],
  [0.2332, 0.251],
  [0.26, 0.29],
  [0.3, 0.5],
];
// Most frequencies averaged in each band, as UTide caps its Lomb-Scargle grid.
const BAND_FREQUENCIES = 100;

/** Fit an offset and caller-selected harmonics using per-sample IHO astronomy. */
export function fit(
  samples: readonly HarmonicSample[],
  names: readonly string[],
  {
    definitions,
    weights,
    robust = false,
    dropDependent = false,
    confidence = false,
  }: FitOptions = {},
): HarmonicFit {
  const count = samples.length;
  if (
    count < Math.max(2, 1 + 2 * names.length) ||
    count > 0x7fffffff ||
    samples.some(
      (s, i) =>
        !Number.isFinite(s.value) ||
        !Number.isFinite(s.time.getTime()) ||
        (i > 0 && s.time < samples[i - 1].time),
    ) ||
    samples[count - 1].time <= samples[0].time
  )
    throw new RangeError("invalidSamples");
  checkWeights(weights, count);
  const prior = weights ? Float64Array.from(weights) : new Float64Array(count).fill(1);
  // Samples weighted zero are out of the record, so they count toward neither its size nor its span.
  const active = samples.filter((_, i) => prior[i] > 0);
  if (active.length < 1 + 2 * names.length || active[active.length - 1].time <= active[0].time)
    throw new RangeError("invalidSamples");

  const catalog = constituentModels(definitions);
  const seen = new Set<string>();
  let fitted = names.map((name) => {
    const model = Object.hasOwn(catalog, name) ? catalog[name] : undefined;
    if (!model) throw new RangeError(`unknownConstituent: ${name}`);
    if (seen.has(model.name)) throw new RangeError(`duplicateConstituent: ${name}`);
    seen.add(model.name);
    return { name, model };
  });
  const dropped: string[] = [];

  // Adapted from https://github.com/openwatersio/tide-database/tree/main/packages/harmonic-analysis.
  const rowAt = (time: Date) => {
    const state = astro(time);
    return [
      1,
      ...fitted.flatMap(({ model }) => {
        const { f, u } = model.correction(state);
        const angle = (model.value(state) + u) * radians;
        return [f * Math.cos(angle), f * Math.sin(angle)];
      }),
    ];
  };

  const solve = (w: Float64Array) => {
    for (;;) {
      const solver = new LeastSquares(1 + 2 * fitted.length);
      samples.forEach(({ time, value }, i) => {
        const scale = Math.sqrt(w[i]);
        if (scale > 0)
          solver.add(
            rowAt(time).map((x) => x * scale),
            value * scale,
          );
      });
      const dependent = solver.dependentColumns();
      if (dependent.length === 0) return { solver, solution: solver.solve() };
      // The offset can't be dropped: a record it can't fit is invalid input.
      if (!dropDependent || dependent[0] === 0) throw new RangeError("rankDeficient");
      const out = new Set(dependent.map((column) => (column - 1) >> 1));
      fitted = fitted.filter(({ name }, j) => !out.has(j) || !dropped.push(name));
    }
  };

  const residualsOf = (solution: readonly number[]) =>
    Float64Array.from(
      samples,
      ({ time, value }) => value - rowAt(time).reduce((sum, x, j) => sum + x * solution[j], 0),
    );

  let w = prior;
  let { solver, solution } = solve(w);
  let residuals = robust || confidence ? residualsOf(solution) : undefined;
  if (robust && residuals) {
    let meanSquare = solver.residualNorm ** 2 / sum(w);
    for (let i = 0; i < ROBUST_ITERATIONS; i++) {
      const next = robustWeights(residuals, prior);
      if (!next) break;
      w = next;
      ({ solver, solution } = solve(w));
      residuals = residualsOf(solution);
      const nextMeanSquare = solver.residualNorm ** 2 / sum(w);
      // Stop once the weighted mean square improves by less than the tolerance, as UTide does.
      if (!((meanSquare - nextMeanSquare) / meanSquare >= ROBUST_TOLERANCE)) break;
      meanSquare = nextMeanSquare;
    }
  }

  const spanHours = (active[active.length - 1].time.getTime() - active[0].time.getTime()) / 3600000;
  const intervals =
    confidence && residuals
      ? colouredIntervals(samples, residuals, w, solver, solution, fitted, spanHours)
      : undefined;

  const unseparable: HarmonicFit["unseparable"] = [];
  fitted.forEach(({ name, model: a }, i) => {
    for (let j = i + 1; j < fitted.length; j++) {
      const hours = 360 / Math.abs(a.speed - fitted[j].model.speed);
      if (hours > spanHours)
        unseparable.push({
          constituents: [name, fitted[j].name],
          requiredDays: Math.ceil(hours / 24),
        });
    }
  });
  unseparable.sort((a, b) => b.requiredDays - a.requiredDays);
  return {
    constituents: fitted.map(({ name }, j) => ({
      name,
      amplitude: Math.hypot(solution[1 + 2 * j], solution[2 + 2 * j]),
      phase: (Math.atan2(solution[2 + 2 * j], solution[1 + 2 * j]) / radians + 360) % 360,
      ...intervals?.[j],
    })),
    offset: solution[0],
    rms: solver.residualNorm / Math.sqrt(sum(w)),
    unseparable,
    dropped,
  };
}

export function checkWeights(weights: readonly number[] | undefined, count: number) {
  if (
    weights &&
    (weights.length !== count ||
      weights.some((w) => !(w >= 0 && w < Infinity)) ||
      !weights.some((w) => w > 0))
  )
    throw new RangeError("invalidWeights");
}

const sum = (values: Float64Array) => values.reduce((total, x) => total + x, 0);

const median = (values: Float64Array) => {
  const sorted = values.slice().sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Cauchy weights for the residuals, times the caller's weights. The scale is
 * UTide's median absolute deviation over 0.6745. UTide also divides each
 * residual by √(1 − leverage), which is within p/n of 1 for a tidal record.
 */
function robustWeights(residuals: Float64Array, prior: Float64Array) {
  // Samples the caller left out don't count toward the scale.
  const scaled = residuals.map((r, i) => Math.sqrt(prior[i]) * r).filter((_, i) => prior[i] > 0);
  const centre = median(scaled);
  const scale = median(scaled.map((r) => Math.abs(r - centre))) / 0.6745;
  // An exact fit to most samples leaves nothing to weigh the rest against.
  if (!(scale > 0)) return undefined;
  return residuals.map(
    (r, i) => prior[i] / (1 + ((Math.sqrt(prior[i]) * r) / (ROBUST_TUNE * scale)) ** 2),
  );
}

/**
 * Linearized 95% intervals and SNR for each constituent. The least-squares
 * covariance of its cosine and sine coefficients is scaled by the residual's
 * spectral level in the constituent's band over the level of white noise with
 * the same variance, so white residuals give the ordinary least-squares interval.
 */
function colouredIntervals(
  samples: readonly HarmonicSample[],
  residuals: Float64Array,
  w: Float64Array,
  solver: LeastSquares,
  solution: readonly number[],
  fitted: readonly { model: Constituent }[],
  spanHours: number,
) {
  const used = samples.flatMap((_, i) => (w[i] > 0 ? [i] : []));
  // Without residual degrees of freedom there is no noise to estimate.
  if (used.length <= solution.length) throw new RangeError("invalidSamples");
  const start = samples[used[0]].time.getTime();
  const hours = Float64Array.from(used, (i) => (samples[i].time.getTime() - start) / 3600000);
  const weighted = Float64Array.from(used, (i) => Math.sqrt(w[i]) * residuals[i]);
  const frequencies = fitted.map(({ model }) => model.speed / 360);
  const levels = BANDS.map((band) => bandLevel(hours, weighted, spanHours, band, frequencies));
  const variance = solver.residualNorm ** 2 / (used.length - solution.length);
  const covariance = solver.unscaledCovariance();
  return frequencies.map((frequency, j) => {
    const band = nearestBand(frequency);
    const scale = variance * levels[band];
    const [c, s] = [1 + 2 * j, 2 + 2 * j];
    const [vcc, vcs, vss] = [covariance(c, c), covariance(c, s), covariance(s, s)].map(
      (v) => v * scale,
    );
    const [x, y] = [solution[c], solution[s]];
    const a2 = x * x + y * y;
    const amplitudeVariance = (x * x * vcc + 2 * x * y * vcs + y * y * vss) / a2;
    const phaseVariance = (y * y * vcc - 2 * x * y * vcs + x * x * vss) / (a2 * a2);
    return {
      amplitudeInterval: 1.96 * Math.sqrt(amplitudeVariance),
      phaseInterval: (1.96 * Math.sqrt(phaseVariance)) / radians,
      snr: a2 / amplitudeVariance,
    };
  });
}

function nearestBand(frequency: number) {
  const distance = ([lo, hi]: readonly [number, number]) =>
    Math.max(lo - frequency, frequency - hi, 0);
  return BANDS.reduce((best, band, i) => (distance(band) < distance(BANDS[best]) ? i : best), 0);
}

/**
 * The residual's mean Hann-windowed periodogram over a band, relative to white
 * noise of the same variance. It skips frequencies within one Rayleigh step of
 * a fitted constituent, where the fit has removed the residual, as UTide does.
 */
function bandLevel(
  hours: Float64Array,
  values: Float64Array,
  spanHours: number,
  [lo, hi]: readonly [number, number],
  fitted: readonly number[],
) {
  const first = Math.ceil(lo * spanHours);
  const last = Math.floor(hi * spanHours);
  const stride = Math.max(1, Math.ceil((last - first + 1) / BAND_FREQUENCIES));
  const steps = last >= first ? Math.floor((last - first) / stride) + 1 : 0;
  const re = new Float64Array(steps);
  const im = new Float64Array(steps);
  let windowSquares = 0;
  let total = 0;
  hours.forEach((t, i) => {
    const h = Math.sin((Math.PI * t) / spanHours) ** 2;
    const v = h * values[i];
    windowSquares += h * h;
    total += values[i] * values[i];
    // e^(−2πi f t) for each frequency on the grid, by stepping one rotation at a time.
    const start = (-2 * Math.PI * first * t) / spanHours;
    const step = (-2 * Math.PI * stride * t) / spanHours;
    let [zr, zi] = [Math.cos(start), Math.sin(start)];
    const [sr, si] = [Math.cos(step), Math.sin(step)];
    for (let m = 0; m < steps; m++) {
      re[m] += v * zr;
      im[m] += v * zi;
      [zr, zi] = [zr * sr - zi * si, zr * si + zi * sr];
    }
  });
  let power = 0;
  let used = 0;
  for (let m = 0; m < steps; m++) {
    const frequency = (first + m * stride) / spanHours;
    if (fitted.some((f) => Math.abs(f - frequency) * spanHours < 1)) continue;
    power += re[m] * re[m] + im[m] * im[m];
    used++;
  }
  // A band with no frequencies to average, or no residual at all, counts as white.
  if (used === 0 || total === 0) return 1;
  return power / used / ((windowSquares * total) / hours.length);
}

/**
 * Least squares by Householder QR of `[R; next batch]`, reduced every batch so a
 * multi-year record needs O(width²) memory. RMS comes from the leftover Qᵀb
 * entries, as SlackwaterKit reads them from DGELS. The QR is kept in step with
 * kotlin/src/main/kotlin/io/openwaters/slackwater/Fit.kt; the rank and
 * covariance helpers are TypeScript only.
 */
class LeastSquares {
  private readonly capacity: number;
  // Column-major, so the reflections walk contiguous memory.
  private readonly a: Float64Array[];
  private readonly b: Float64Array;
  private readonly v: Float64Array;
  // Rows below `width` hold R and Qᵀb; they start as zero rows, which add nothing.
  private rows: number;
  private count = 0;
  residualNorm = 0;

  constructor(private readonly width: number) {
    this.capacity = width + Math.max(512, width);
    this.a = Array.from({ length: width }, () => new Float64Array(this.capacity));
    this.b = new Float64Array(this.capacity);
    this.v = new Float64Array(this.capacity);
    this.rows = width;
  }

  add(row: readonly number[], value: number) {
    for (let j = 0; j < this.width; j++) this.a[j][this.rows] = row[j];
    this.b[this.rows++] = value;
    this.count++;
    if (this.rows === this.capacity) this.reduce();
  }

  private reduce() {
    const { a, b, v, width, rows } = this;
    for (let k = 0; k < width; k++) {
      const pivot = a[k];
      let norm = 0;
      for (let i = k; i < rows; i++) norm += pivot[i] * pivot[i];
      // A column already zero from row k down needs no reflection.
      if (norm === 0) continue;
      norm = Math.sqrt(norm);
      const alpha = pivot[k] > 0 ? -norm : norm;
      let vv = 0;
      for (let i = k; i < rows; i++) {
        v[i] = i === k ? pivot[i] - alpha : pivot[i];
        vv += v[i] * v[i];
      }
      for (let j = k + 1; j < width; j++) this.reflect(a[j], k, vv);
      this.reflect(b, k, vv);
      pivot[k] = alpha;
      pivot.fill(0, k + 1, rows);
    }
    // Rows past R are zero in every column, so their Qᵀb entries are residual no later batch can reduce.
    // hypot, because squaring a residual near the largest finite value overflows.
    for (let i = width; i < rows; i++) this.residualNorm = Math.hypot(this.residualNorm, b[i]);
    this.rows = width;
  }

  private reflect(column: Float64Array, k: number, vv: number) {
    const { v, rows } = this;
    let dot = 0;
    for (let i = k; i < rows; i++) dot += v[i] * column[i];
    // Divide first: 2 · dot can overflow when the reflected value is finite.
    const scale = 2 * (dot / vv);
    for (let i = k; i < rows; i++) column[i] -= scale * v[i];
  }

  /** Columns that numerically depend on the columns before them, as SlackwaterKit rejects after DGELS. */
  dependentColumns(): number[] {
    if (this.rows > this.width) this.reduce();
    const diagonal = this.a.map((column, i) => Math.abs(column[i]));
    const threshold = Number.EPSILON * this.count * Math.max(...diagonal);
    return diagonal.flatMap((value, i) => (value > threshold ? [] : [i]));
  }

  /** Call once `dependentColumns` finds none. */
  solve(): number[] {
    const { a, b, width } = this;
    const x = new Array<number>(width);
    for (let i = width - 1; i >= 0; i--) {
      let sum = b[i];
      for (let j = i + 1; j < width; j++) sum -= a[j][i] * x[j];
      x[i] = sum / a[i][i];
    }
    if (!x.every(Number.isFinite)) throw new RangeError("rankDeficient");
    return x;
  }

  /** Entries of (RᵀR)⁻¹ = (AᵀA)⁻¹, from R⁻¹. Call after `solve`. */
  unscaledCovariance() {
    const { a, width } = this;
    // inverse[j][i] holds (R⁻¹)ᵢⱼ, upper triangular like R.
    const inverse = Array.from({ length: width }, () => new Float64Array(width));
    for (let j = 0; j < width; j++) {
      inverse[j][j] = 1 / a[j][j];
      for (let i = j - 1; i >= 0; i--) {
        let sum = 0;
        for (let k = i + 1; k <= j; k++) sum += a[k][i] * inverse[j][k];
        inverse[j][i] = -sum / a[i][i];
      }
    }
    return (p: number, q: number) => {
      let sum = 0;
      for (let k = Math.max(p, q); k < width; k++) sum += inverse[k][p] * inverse[k][q];
      return sum;
    };
  }
}
