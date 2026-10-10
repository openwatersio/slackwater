export function positiveNumber(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${name}: "${value}". Expected a positive number.`);
  }
  return number;
}

export function positiveInteger(value: string, name: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number <= 0) {
    throw new Error(`Invalid ${name}: "${value}". Expected a positive whole number.`);
  }
  return number;
}

/**
 * The number of stations a listing shows. `Infinity` for `--all`, passed to
 * the database explicitly because its `near` and `search` cap results at 10
 * and 20 when `maxResults` is undefined.
 */
export function stationLimit(opts: { all?: boolean; limit: string }): number {
  return opts.all ? Infinity : positiveInteger(opts.limit, "limit");
}
