export interface WaterLevelReading {
  time: Date;
  observed: number;
  predicted: number;
}

export interface ResidualSample {
  time: Date;
  value: number;
}

export interface ResidualTrend {
  time: Date;
  slopePerHour: number;
  direction: "rising" | "steady" | "falling";
}

const hour = 3600000;

function validateTime(time: Date, previous: number): number {
  const instant = time.getTime();
  if (!Number.isFinite(instant) || instant <= previous) throw new RangeError("invalidSamples");
  return instant;
}

function finiteResult(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("nonFiniteResult");
  return value;
}

function validateHourly(samples: readonly ResidualSample[]): void {
  let previous = -Infinity;
  for (const sample of samples) {
    const instant = validateTime(sample.time, previous);
    if (!Number.isFinite(sample.value)) throw new RangeError("invalidSamples");
    if (previous !== -Infinity && (instant - previous) % hour !== 0)
      throw new RangeError("invalidCadence");
    previous = instant;
  }
}

export function residuals(readings: readonly WaterLevelReading[]): ResidualSample[] {
  let previous = -Infinity;
  return readings.map((reading) => {
    previous = validateTime(reading.time, previous);
    if (!Number.isFinite(reading.observed) || !Number.isFinite(reading.predicted))
      throw new RangeError("invalidSamples");
    return { time: reading.time, value: finiteResult(reading.observed - reading.predicted) };
  });
}

function movingMean(values: number[], width: number): number[] {
  const output: number[] = [];
  for (let i = 0; i <= values.length - width; i++) {
    let sum = 0;
    for (let j = 0; j < width; j++) sum += values[i + j];
    output.push(finiteResult(sum / width));
  }
  return output;
}

export function filterResiduals(samples: readonly ResidualSample[]): ResidualSample[] {
  validateHourly(samples);
  const output: ResidualSample[] = [];
  let start = 0;
  for (let end = 1; end <= samples.length; end++) {
    if (
      end < samples.length &&
      samples[end].time.getTime() - samples[end - 1].time.getTime() === hour
    )
      continue;
    if (end - start >= 71) {
      let values = samples.slice(start, end).map((sample) => sample.value);
      for (const width of [24, 24, 25]) values = movingMean(values, width);
      values.forEach((value, i) => output.push({ time: samples[start + i + 35].time, value }));
    }
    start = end;
  }
  return output;
}

export function residualTrend(samples: readonly ResidualSample[]): ResidualTrend | undefined {
  validateHourly(samples);
  if (samples.length < 25) return undefined;
  const window = samples.slice(-25);
  if (window[24].time.getTime() - window[0].time.getTime() !== 24 * hour) return undefined;
  // Subtract a nearby baseline before multiplying to retain small slopes on large offsets.
  const baseline = window[12].value;
  let covariance = 0;
  for (let i = 0; i < 25; i++) covariance += (i - 12) * (window[i].value - baseline);
  // Centered hourly indices -12...12 have squared sum 1300.
  const slopePerHour = finiteResult(covariance / 1300);
  const change = finiteResult(slopePerHour * 24);
  const direction = Math.abs(change) <= 0.01 + 1e-12 ? "steady" : change > 0 ? "rising" : "falling";
  return { time: window[24].time, slopePerHour, direction };
}
