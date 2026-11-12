import astro from "./astronomy/index.js";
import { constituentModels } from "./constituents/index.js";
import type { ConstituentDefinition } from "./constituents/types.js";
import type { HarmonicConstituent } from "./harmonics/index.js";

export interface HarmonicSample {
  time: Date;
  value: number;
}

export interface HarmonicFit {
  constituents: HarmonicConstituent[];
  offset: number;
  rms: number;
  unseparable: { constituents: [string, string]; requiredDays: number }[];
}

export interface FitOptions {
  /** Constituents to add to the catalog, or to replace catalog entries of the same name. */
  definitions?: readonly ConstituentDefinition[];
}

/** Fit an offset and caller-selected harmonics using per-sample IHO astronomy. */
export function fit(
  samples: readonly HarmonicSample[],
  names: readonly string[],
  { definitions }: FitOptions = {},
): HarmonicFit {
  const width = 1 + 2 * names.length;
  const count = samples.length;
  if (
    count < Math.max(2, width) ||
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

  const constituents = constituentModels(definitions);
  const seen = new Set<string>();
  const models = names.map((name) => {
    const model = Object.hasOwn(constituents, name) ? constituents[name] : undefined;
    if (!model) throw new RangeError(`unknownConstituent: ${name}`);
    if (seen.has(model.name)) throw new RangeError(`duplicateConstituent: ${name}`);
    seen.add(model.name);
    return model;
  });
  const radians = Math.PI / 180;
  // Adapted from https://github.com/openwatersio/tide-database/tree/main/packages/harmonic-analysis.
  const rowAt = (time: Date) => {
    const state = astro(time);
    return [
      1,
      ...models.flatMap((model) => {
        const { f, u } = model.correction(state);
        const angle = (model.value(state) + u) * radians;
        return [f * Math.cos(angle), f * Math.sin(angle)];
      }),
    ];
  };
  const solver = new LeastSquares(width);
  for (const { time, value } of samples) solver.add(rowAt(time), value);
  const solution = solver.solve();
  const rms = solver.residualNorm / Math.sqrt(count);

  const unseparable: HarmonicFit["unseparable"] = [];
  const spanHours = (samples[count - 1].time.getTime() - samples[0].time.getTime()) / 3600000;
  models.forEach((a, i) => {
    for (let j = i + 1; j < models.length; j++) {
      const hours = 360 / Math.abs(a.speed - models[j].speed);
      if (hours > spanHours)
        unseparable.push({
          constituents: [names[i], names[j]],
          requiredDays: Math.ceil(hours / 24),
        });
    }
  });
  unseparable.sort((a, b) => b.requiredDays - a.requiredDays);
  return {
    constituents: names.map((name, j) => ({
      name,
      amplitude: Math.hypot(solution[1 + 2 * j], solution[2 + 2 * j]),
      phase: (Math.atan2(solution[2 + 2 * j], solution[1 + 2 * j]) / radians + 360) % 360,
    })),
    offset: solution[0],
    rms,
    unseparable,
  };
}

/**
 * Least squares by Householder QR of `[R; next batch]`, reduced every batch so a
 * multi-year record needs O(width²) memory. RMS comes from the leftover Qᵀb
 * entries, as SlackwaterKit reads them from DGELS. Kept in step with
 * kotlin/src/main/kotlin/io/openwaters/slackwater/Fit.kt.
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

  solve(): number[] {
    if (this.rows > this.width) this.reduce();
    const { a, b, width } = this;
    const diagonal = a.map((column, i) => Math.abs(column[i]));
    // Reject numerical rank loss, not only exact zero pivots, as SlackwaterKit does after DGELS.
    const threshold = Number.EPSILON * this.count * Math.max(...diagonal);
    if (diagonal.some((value) => !(value > threshold))) throw new RangeError("rankDeficient");
    const x = new Array<number>(width);
    for (let i = width - 1; i >= 0; i--) {
      let sum = b[i];
      for (let j = i + 1; j < width; j++) sum -= a[j][i] * x[j];
      x[i] = sum / a[i][i];
    }
    if (!x.every(Number.isFinite)) throw new RangeError("rankDeficient");
    return x;
  }
}
