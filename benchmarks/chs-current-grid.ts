// The fit-end grid benchmarks/chs-current-fit.ts scores on, shared with the
// results repository, which pools its rows. Grid point i's fit ends on
// ANCHOR + 28i + 7(i mod 4) days. A plain 28-day grid sits 0.45 days off the
// 27.55-day anomalistic month, which would hold every held-out age to a
// five-day slice of the perigee cycle; staggering the fit end by whole weeks
// spreads each age across the cycle while keeping fit ends on the epoch-week
// grid IWLS chunks use. Held-out weeks start OFFSET_DAYS after the fit end, so
// each age is exact.
export const ANCHOR = "2026-10-29";
export const OFFSET_DAYS = [0, 28, 90, 180, 270] as const;
export const WEEK_DAYS = 7;
/** How far apart a CHS slack and a predicted slack may be and still pair, and how far a scored CHS extremum may be from its predicted match. */
export const MATCH_WINDOW_MIN = 180;
/** The span around a held-out week whose events take part in pairing, so a slack just outside the week can pair with its own neighbour rather than one inside the week. */
export const CONTEXT_MIN = 2 * MATCH_WINDOW_MIN;

const DAY = 86_400_000;
const anchorMs = Date.parse(`${ANCHOR}T00:00:00Z`);

/** Whole weeks, 0 to 21 days, for negative indices too. */
export function stagger(i: number): number {
  return 7 * (((i % 4) + 4) % 4);
}

/** The calendar date grid point `i`'s fit ends on, as YYYY-MM-DD. */
export function fitEndDate(i: number): string {
  if (!Number.isInteger(i)) throw new RangeError(`grid index must be an integer: ${i}`);
  return new Date(anchorMs + (28 * i + stagger(i)) * DAY).toISOString().slice(0, 10);
}

/** The newest grid point whose fit ends on or before `date` (YYYY-MM-DD). */
export function gridIndexOnOrBefore(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) throw new RangeError(`not a date: ${date}`);
  // Grid point i ends at least 28i days after the anchor, so this guess is past the date.
  let i = Math.floor((target - anchorMs) / (28 * DAY)) + 1;
  while (Date.parse(`${fitEndDate(i)}T00:00:00Z`) > target) i--;
  return i;
}

/** The grid point whose fit ends on `date`. */
export function gridIndexOf(date: string): number {
  const i = gridIndexOnOrBefore(date);
  if (fitEndDate(i) !== date) {
    throw new RangeError(
      `${date} is not a grid fit-end date; the one before it is ${fitEndDate(i)}`,
    );
  }
  return i;
}

/** Whether every held-out week of a fit ending at `fitEndMs`, with its pairing context, ends by `horizonMs`. */
export function withinHorizon(
  fitEndMs: number,
  horizonMs: number,
  offsets: readonly number[] = OFFSET_DAYS,
): boolean {
  const last = fitEndMs + (Math.max(...offsets) + WEEK_DAYS) * DAY + CONTEXT_MIN * 60_000;
  return last <= horizonMs;
}

/** Splits [fromMs, toMs] into consecutive spans, oldest first, each at most the seven days docs/iwls-fetch.md allows one IWLS request. */
export function requestSpans(fromMs: number, toMs: number): [number, number][] {
  const longest = 7 * DAY;
  const spans: [number, number][] = [];
  for (let t = fromMs; t < toMs; t += longest) spans.push([t, Math.min(t + longest, toMs)]);
  return spans;
}

/**
 * The grid points a run scores: `FIT_END=YYYY-MM-DD` names one by its date,
 * `GRID=a..b` or `GRID=a,b,c` by index, and neither means the newest on or
 * before `today`. A grid point after today has no fit a device could hold yet.
 */
export function selectGrid(env: { GRID?: string; FIT_END?: string }, today: string): number[] {
  // An empty value is a mistake, such as an unset CI input, not a request for the default.
  if (env.GRID === "") throw new RangeError("GRID is set but empty");
  if (env.FIT_END === "") throw new RangeError("FIT_END is set but empty");
  if (env.GRID && env.FIT_END) throw new RangeError("set GRID or FIT_END, not both");
  const newest = gridIndexOnOrBefore(today);
  let points: number[];
  if (env.FIT_END) points = [gridIndexOf(env.FIT_END)];
  else if (!env.GRID) points = [newest];
  else {
    const range = /^(-?\d+)\.\.(-?\d+)$/.exec(env.GRID);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b) throw new RangeError(`GRID range runs backwards: ${env.GRID}`);
      points = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    } else {
      points = env.GRID.split(",").map((s) => {
        if (!/^-?\d+$/.test(s)) throw new RangeError(`GRID has a bad index: ${s}`);
        return Number(s);
      });
    }
  }
  const late = points.filter((i) => i > newest);
  if (late.length) throw new RangeError(`grid points ${late.join(", ")} end after ${today}`);
  return points;
}
