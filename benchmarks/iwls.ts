// The IWLS fetching contract in docs/iwls-fetch.md, for scripts in this repo.
// Unpublished on purpose: the contract fetches CHS data for one device, and
// nothing that serves predictions (the API, the CLI) may depend on it.
export const BASE = "https://api-iwls.dfo-mpo.gc.ca/api/v1";
const WEEK_S = 604_800;
const resolutions = new Map([
  [1, "ONE_MINUTE"],
  [3, "THREE_MINUTES"],
  [5, "FIVE_MINUTES"],
  [15, "FIFTEEN_MINUTES"],
  [60, "SIXTY_MINUTES"],
]);
export const emptyLifetimeMs = 86_400_000;

export function resolutionFor(sampleMinutes: number): string {
  const resolution = resolutions.get(sampleMinutes);
  if (!resolution) throw new IwlsError("permanent", "unsupported IWLS sample grid");
  return resolution;
}

export const resolveToleranceKm = 3;
export const fitSeries = new Set(["wlp", "wcsp1", "wcdp1"]);
export const maxAttempts = 4;
/** The longest `Retry-After` the client waits, so one header cannot hold a queue for hours. */
export const maxRetryAfter = 600;

export interface Sample {
  t: number;
  v: number;
}

/** Epoch milliseconds, `start` and `end` both inclusive. */
export interface Chunk {
  start: number;
  end: number;
}

export interface IwlsStation {
  id: string;
  code: string;
  officialName: string;
  latitude: number;
  longitude: number;
  timeSeries: { code: string }[];
}

export class IwlsError extends Error {
  readonly kind: "permanent" | "transient";

  constructor(kind: "permanent" | "transient", message: string) {
    super(message);
    this.name = "IwlsError";
    this.kind = kind;
  }
}

export function resolve(
  name: string,
  latitude: number,
  longitude: number,
  series: string,
  stations: IwlsStation[],
): IwlsStation {
  let best: IwlsStation | undefined;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    if (!station.timeSeries.some((s) => s.code === series)) continue;
    const km = distanceKm(latitude, longitude, station.latitude, station.longitude);
    // Strictly nearer, so ties keep list order.
    if (km < bestKm) [best, bestKm] = [station, km];
  }
  if (!best) throw new IwlsError("permanent", `no IWLS station serves ${series}`);
  if (bestKm > resolveToleranceKm) {
    throw new IwlsError(
      "permanent",
      `${name}: nearest ${series} station ${best.officialName} is ${bestKm.toFixed(1)} km away`,
    );
  }
  return best;
}

/** The start of `now`'s calendar day in `timeZone`, which a DST day can make 23 or 25 hours long. */
export function localMidnight(now: Date, timeZone: string): Date {
  const { year, month, day } = wallClock(now.getTime(), timeZone);
  const wall = Date.UTC(year, month - 1, day);
  // Local midnight lies within 14 hours of the UTC one, so one of the offsets in force
  // there maps the wall time onto it. A transition at midnight puts some guesses on the
  // neighbouring day, or on a repeated midnight's second pass; the earliest guess on the
  // right day is the first midnight, or the first instant of a day that skips it.
  const hours = 3_600_000;
  const offsets = new Set([-14, 0, 14].map((h) => offsetMs(wall + h * hours, timeZone)));
  const onDay = (t: number) => {
    const w = wallClock(t, timeZone);
    return w.year === year && w.month === month && w.day === day;
  };
  return new Date(Math.min(...[...offsets].map((o) => wall - o).filter(onDay)));
}

/** Newest first, on the absolute 7-day epoch grid, spanning at least `days` and less than `days + 7`. */
export function chunkPlan(days: number, end: Date): Chunk[] {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError("chunkPlan needs a positive, finite duration");
  }
  const endS = end.getTime() / 1000;
  const out: Chunk[] = [];
  for (let t = Math.floor((endS - days * 86_400) / WEEK_S) * WEEK_S; t < endS; t += WEEK_S) {
    out.push({ start: t * 1000, end: Math.min(t + WEEK_S, endS) * 1000 });
  }
  return out.reverse();
}

export function isCacheable(chunk: Chunk): boolean {
  return (
    Number.isFinite(chunk.start) &&
    chunk.start % (WEEK_S * 1000) === 0 &&
    chunk.end - chunk.start === WEEK_S * 1000
  );
}

/** Complete endpoints prevent a truncated response from becoming a permanent missing span. */
export function canCache(chunk: Chunk, samples: Sample[], sampleMinutes = 15): boolean {
  resolutionFor(sampleMinutes);
  return (
    isCacheable(chunk) &&
    samples.length > 0 &&
    samples.every(
      (s) =>
        Number.isFinite(s.v) &&
        s.t >= chunk.start &&
        s.t <= chunk.end &&
        s.t % (sampleMinutes * 60_000) === 0,
    ) &&
    samples.some((s) => s.t === chunk.start) &&
    samples.some((s) => s.t === chunk.end)
  );
}

export interface ChunkCacheEntry {
  startMs: number;
  endMs: number;
  sampleMinutes: number;
  fetchedAtMs: number;
  samples: Sample[];
}

export function cacheEntry(
  chunk: Chunk,
  samples: Sample[],
  sampleMinutes = 15,
  fetchedAtMs = Date.now(),
): ChunkCacheEntry | undefined {
  resolutionFor(sampleMinutes);
  if (
    !Number.isFinite(fetchedAtMs) ||
    !isCacheable(chunk) ||
    (samples.length > 0 && !canCache(chunk, samples, sampleMinutes))
  )
    return undefined;
  return { startMs: chunk.start, endMs: chunk.end, sampleMinutes, fetchedAtMs, samples };
}

export function isReusable(
  entry: ChunkCacheEntry,
  chunk: Chunk,
  sampleMinutes = 15,
  nowMs = Date.now(),
): boolean {
  resolutionFor(sampleMinutes);
  if (
    entry.startMs !== chunk.start ||
    entry.endMs !== chunk.end ||
    entry.sampleMinutes !== sampleMinutes ||
    !Number.isFinite(entry.fetchedAtMs) ||
    !isCacheable(chunk)
  )
    return false;
  if (entry.samples.length > 0) return canCache(chunk, entry.samples, sampleMinutes);
  const age = nowMs - entry.fetchedAtMs;
  return age >= 0 && age < emptyLifetimeMs;
}

export function dataURL(code: string, stationID: string, chunk: Chunk, sampleMinutes = 15): URL {
  // Only the fit series: the grid filter would silently empty event series like wlp-hilo.
  if (
    !stationID ||
    !fitSeries.has(code) ||
    !Number.isFinite(chunk.start) ||
    !Number.isFinite(chunk.end) ||
    chunk.end < chunk.start ||
    chunk.end - chunk.start > WEEK_S * 1000
  ) {
    throw new IwlsError("permanent", "invalid IWLS series request");
  }
  const url = new URL(`${BASE}/stations/${pathComponent(stationID)}/data`);
  url.search = new URLSearchParams({
    "time-series-code": code,
    from: iso(chunk.start),
    to: iso(chunk.end),
    resolution: resolutionFor(sampleMinutes),
  }).toString();
  return url;
}

/** Samples in response order, dropping a timestamp only when it repeats the one just kept. */
export function decode(raw: unknown): Sample[] {
  if (!Array.isArray(raw)) throw new TypeError("IWLS samples must be an array");
  const out: Sample[] = [];
  for (const row of raw) {
    if (typeof row?.eventDate !== "string" || typeof row?.value !== "number") {
      throw new TypeError("IWLS sample needs a string eventDate and a numeric value");
    }
    const t = parseEventDate(row.eventDate);
    if (t === undefined) continue;
    if (out.at(-1)?.t !== t) out.push({ t, v: row.value });
  }
  return out;
}

export function onGrid(samples: Sample[], sampleMinutes = 15): Sample[] {
  resolutionFor(sampleMinutes);
  return samples.filter((s) => s.t % (sampleMinutes * 60_000) === 0);
}

/** Seconds to wait before another attempt, or `null` when the client should not retry. */
export function retryDelay(
  outcome: { status: number } | { error: unknown },
  attempt: number,
  retryAfter?: number,
): number | null {
  if (attempt >= maxAttempts) return null;
  const backoff = 2 ** attempt;
  // Non-finite or negative asks cannot be slept for.
  const asked =
    retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.min(retryAfter, maxRetryAfter)
      : 0;
  if ("error" in outcome) return isTransient(outcome.error) ? backoff : null;
  if (outcome.status === 429) return Math.max(asked, 60);
  if (outcome.status >= 500 && outcome.status <= 599 && ![501, 505, 511].includes(outcome.status)) {
    return Math.max(asked, backoff);
  }
  return null;
}

export function terminalError(status: number): IwlsError {
  return status >= 400 && status <= 499 && status !== 429
    ? new IwlsError("permanent", `HTTP ${status}`)
    : new IwlsError("transient", `HTTP ${status}`);
}

// Node's fetch reports transport failures as a TypeError whose cause carries the
// socket or undici code: timeouts, refused or unreachable hosts, DNS, lost links.
const transientCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNABORTED",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** A 200 with no body: the contract's empty response, transient as Swift's `zeroByteResource` is. */
export class EmptyResponseError extends Error {
  constructor() {
    super("IWLS sent an empty response");
    this.name = "EmptyResponseError";
  }
}

export function isTransient(error: unknown): boolean {
  if (error instanceof EmptyResponseError) return true;
  // The default fetch's per-attempt bound, Swift's `timedOut`.
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  const code = (error as { cause?: { code?: unknown } })?.cause?.code;
  // HPE_ codes are llhttp parse errors: an invalid server response.
  return (
    error instanceof TypeError &&
    typeof code === "string" &&
    (transientCodes.has(code) || code.startsWith("HPE_"))
  );
}

/** Admits request starts one at a time, `interval` milliseconds apart on the monotonic clock. */
export class Pacer {
  readonly interval: number;
  private last: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(interval = 2500) {
    this.interval = interval;
  }

  // Each waiter is admitted only after the one before it, and the gap is measured from
  // when that one was actually admitted, so a stalled event loop cannot release a burst.
  // A cancelled waiter is never admitted and so holds no slot.
  wait(signal?: AbortSignal): Promise<void> {
    const turn = this.queue.then(async () => {
      signal?.throwIfAborted();
      if (this.last !== undefined) {
        const due = this.last + this.interval;
        // Timers run on a whole-millisecond loop clock and can fire just short of `due`.
        while (performance.now() < due) await delay(Math.max(1, due - performance.now()), signal);
      }
      this.last = performance.now();
    });
    this.queue = turn.catch(() => {});
    if (!signal) return turn;
    // A waiter queued behind another rejects as soon as it is cancelled, not when its turn comes.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Shared by every default client in the process, so separate callers cannot double the request rate. */
export const pacer = new Pacer();

export interface Metadata {
  timeZoneCode?: string;
  floodDirection?: number;
  ebbDirection?: number;
}

export interface ClientOptions {
  fetch?: (url: URL, signal?: AbortSignal) => Promise<Response>;
  sleep?: (seconds: number, signal?: AbortSignal) => Promise<void>;
  pacer?: Pacer;
}

/** Every call takes an optional signal that cancels its pacing, backoff, and request. */
export function createClient(options: ClientOptions = {}) {
  // Each attempt is bounded at 300 seconds, as Swift's resource timeout bounds it; undici's
  // own timeouts measure idle time, so a trickling response would otherwise never end.
  const request =
    options.fetch ??
    ((url: URL, signal?: AbortSignal) => {
      const timeout = AbortSignal.timeout(300_000);
      return fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    });
  const sleep =
    options.sleep ?? ((seconds: number, signal?: AbortSignal) => delay(seconds * 1000, signal));
  const requestPacer = options.pacer ?? pacer;

  async function get(url: URL, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      await requestPacer.wait(signal);
      let outcome: { status: number } | { error: unknown };
      let retryAfter: number | undefined;
      try {
        const res = await request(url, signal);
        // Only a 200 supplies a body; decoding errors are not retried, but an empty body is.
        if (res.status === 200) {
          const text = await res.text();
          if (text !== "") return JSON.parse(text);
          outcome = { error: new EmptyResponseError() };
        } else {
          await res.body?.cancel();
          outcome = { status: res.status };
          retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
        }
      } catch (error) {
        outcome = { error };
      }
      const seconds = retryDelay(outcome, attempt, retryAfter);
      if (seconds === null) {
        if ("error" in outcome) throw outcome.error;
        throw terminalError(outcome.status);
      }
      await sleep(seconds, signal);
    }
  }

  return {
    pacer: requestPacer,
    get,
    async stationList(signal?: AbortSignal): Promise<IwlsStation[]> {
      return (await get(new URL(`${BASE}/stations`), signal)) as IwlsStation[];
    },
    async metadata(stationID: string, signal?: AbortSignal): Promise<Metadata> {
      const raw = (await get(
        new URL(`${BASE}/stations/${pathComponent(stationID)}/metadata`),
        signal,
      )) as Record<string, unknown>;
      return {
        timeZoneCode: typeof raw.timeZoneCode === "string" ? raw.timeZoneCode : undefined,
        floodDirection: typeof raw.floodDirection === "number" ? raw.floodDirection : undefined,
        ebbDirection: typeof raw.ebbDirection === "number" ? raw.ebbDirection : undefined,
      };
    },
    /** One fit-series chunk on the consumer recipe’s grid. */
    async series(
      code: string,
      stationID: string,
      chunk: Chunk,
      signal?: AbortSignal,
      sampleMinutes = 15,
    ): Promise<Sample[]> {
      return onGrid(
        decode(await get(dataURL(code, stationID, chunk, sampleMinutes), signal)),
        sampleMinutes,
      );
    },
  };
}

export type IwlsClient = ReturnType<typeof createClient>;

// Decimal seconds only: no surrounding spaces, no binary or octal literals, no HTTP date.
// Values Swift's `Double(String)` also reads but no client can sleep for (nan, inf) fall
// back to the default delay either way.
const RETRY_AFTER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseRetryAfter(header: string | null): number | undefined {
  return header !== null && RETRY_AFTER.test(header) ? Number(header) : undefined;
}

// Whole seconds with a UTC designator or numeric offset; fractional seconds are skipped, as the contract says.
const EVENT_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseEventDate(value: string): number | undefined {
  if (!EVENT_DATE.test(value)) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

// One path component: `/`, `%`, `?` and `#` escaped, the other sub-delimiters kept, as Swift's client does.
export function pathComponent(id: string): string {
  // "." and ".." are dot segments: URL resolution removes them, escaped or not.
  if (id === "" || id === "." || id === "..") {
    throw new IwlsError("permanent", "invalid IWLS station id");
  }
  return encodeURIComponent(id).replace(/%(24|26|2B|2C|3B|3D|3A|40)/gi, (m) =>
    decodeURIComponent(m),
  );
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function wallClock(t: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(t)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function offsetMs(t: number, timeZone: string): number {
  const w = wallClock(t, timeZone);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000
  );
}
