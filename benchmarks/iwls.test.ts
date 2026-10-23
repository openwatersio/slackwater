import { describe, expect, test, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  IwlsError,
  Pacer,
  canCache,
  cacheEntry,
  isReusable,
  resolutionFor,
  chunkPlan,
  createClient,
  dataURL,
  decode,
  isCacheable,
  localMidnight,
  onGrid,
  pacer,
  pathComponent,
  resolve,
  retryDelay,
  terminalError,
  type Sample,
} from "./iwls.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/iwls-fetch.json"), "utf-8"),
);

describe("the shared IWLS fetching contract", () => {
  test("is the version this implementation follows", () => {
    expect(fixture.version).toBe(2);
  });

  test("resolves by position and series, never by name", () => {
    for (const row of fixture.resolution) {
      const run = () => resolve(row.name, row.latitude, row.longitude, row.series, row.stations);
      if (row.expectedID) expect(run().id, row.name).toBe(row.expectedID);
      else expect(run, row.name).toThrow(IwlsError);
    }
  });

  test("anchors at the station's local midnight across DST", () => {
    for (const row of fixture.midnights) {
      expect(localMidnight(new Date(row.now), row.timeZone).toISOString(), row.now).toBe(
        new Date(row.expected).toISOString(),
      );
    }
  });

  test("plans newest-first chunks on the absolute 7-day epoch grid", () => {
    for (const row of fixture.plans) {
      const plan = chunkPlan(row.days, new Date(row.endSeconds * 1000));
      expect(plan.map((c) => [c.start / 1000, c.end / 1000])).toEqual(row.expected);
    }
    const end = new Date(1_785_000_000_000);
    const short = chunkPlan(60, end);
    const long = chunkPlan(210, end);
    expect(long.slice(0, short.length)).toEqual(short);
    const tomorrow = chunkPlan(210, new Date(end.getTime() + 86_400_000));
    const key = (c: { start: number; end: number }) => `${c.start}-${c.end}`;
    const kept = new Set(long.filter(isCacheable).map(key));
    expect(
      tomorrow.filter(isCacheable).filter((c) => kept.has(key(c))).length,
    ).toBeGreaterThanOrEqual(28);
    expect(() => chunkPlan(Number.POSITIVE_INFINITY, end)).toThrow(RangeError);
    expect(() => chunkPlan(0, end)).toThrow(RangeError);
  });

  test("caches only full, non-empty weeks", () => {
    const week = { start: 0, end: 604_800_000 };
    expect(
      canCache(week, [
        { t: 0, v: 1 },
        { t: 604_800_000, v: 1 },
      ]),
    ).toBe(true);
    expect(canCache(week, [])).toBe(false);
    expect(canCache({ start: 0, end: 900_000 }, [{ t: 0, v: 1 }])).toBe(false);
  });

  test("decodes with adjacent duplicate suppression and keeps the fit grid", () => {
    for (const row of fixture.decoding) {
      const decoded = decode(row.raw);
      expect(decoded).toEqual(row.expected);
      expect(onGrid(decoded)).toEqual(row.grid);
      expect(onGrid(row.expected)).toEqual(row.grid);
    }
    // Swift's ISO8601DateFormatter reads an offset with or without its colon.
    expect(decode([{ eventDate: "1970-01-01T05:30:00+0530", value: 1 }])).toEqual([{ t: 0, v: 1 }]);
    expect(() => decode({})).toThrow();
    expect(() => decode([{ eventDate: "1970-01-01T00:00:00Z" }])).toThrow();
    const combined = fixture.boundaryResponses.flatMap((r: unknown) => decode(r));
    expect(combined).toEqual(fixture.boundaryExpected);
  });

  test("requests the resolved id at 15-minute resolution", () => {
    const row = fixture.request;
    const url = dataURL(row.series, row.stationID, {
      start: row.startSeconds * 1000,
      end: row.endSeconds * 1000,
    });
    expect(url.pathname).toBe(row.path);
    expect(Object.fromEntries(url.searchParams)).toEqual(row.query);
  });

  test("encodes the resolved id as one path component", () => {
    for (const row of fixture.pathComponents) {
      const url = () => dataURL("wlp", row.id, { start: 0, end: 900_000 });
      // The metadata URL takes the bare component, without dataURL's own checks.
      const component = () => pathComponent(row.id);
      if (row.encoded === null) {
        expect(url, row.id).toThrow(IwlsError);
        expect(component, row.id).toThrow(IwlsError);
      } else {
        expect(url().pathname, row.id).toBe(`/api/v1/stations/${row.encoded}/data`);
        expect(component(), row.id).toBe(row.encoded);
      }
    }
  });

  test("refuses event series and windows longer than a week", () => {
    const chunk = { start: 0, end: 900_000 };
    for (const code of ["wlp-hilo", "wcp1-events", ""]) {
      expect(() => dataURL(code, "id", chunk), code).toThrow(IwlsError);
    }
    expect(() => dataURL("wlp", "id", { start: 0, end: 604_801_000 })).toThrow(IwlsError);
    expect(() => dataURL("wlp", "id", { start: 900_000, end: 0 })).toThrow(IwlsError);
    expect(dataURL("wcsp1", "id/path?bad=2", chunk).pathname).toBe(
      "/api/v1/stations/id%2Fpath%3Fbad=2/data",
    );
  });

  test("retries what another attempt could get past", () => {
    for (const row of fixture.retries) {
      expect(
        retryDelay({ status: row.status }, row.attempt, row.retryAfter ?? undefined),
        JSON.stringify(row),
      ).toBe(row.delay);
    }
    for (const code of [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNABORTED",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_SOCKET",
      "UND_ERR_CLOSED",
      // An unparseable response from IWLS or a proxy, Swift's `badServerResponse`.
      "HPE_INVALID_CONSTANT",
    ]) {
      expect(retryDelay({ error: fetchFailed(code) }, 1), code).toBe(2);
    }
    for (const error of [
      fetchFailed("CERT_HAS_EXPIRED"),
      new DOMException("aborted", "AbortError"),
      new Error("other"),
    ]) {
      expect(retryDelay({ error }, 1)).toBeNull();
    }
    // The default fetch's 300-second bound, Swift's `timedOut`.
    expect(retryDelay({ error: new DOMException("timed out", "TimeoutError") }, 1)).toBe(2);
    // JSON cannot carry these, and a header can parse to any of them.
    for (const header of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(retryDelay({ status: 429 }, 1, header)).toBe(60);
      expect(retryDelay({ status: 503 }, 1, header)).toBe(2);
    }
    expect(terminalError(404)).toEqual(new IwlsError("permanent", "HTTP 404"));
    expect(terminalError(429)).toEqual(new IwlsError("transient", "HTTP 429"));
    expect(terminalError(503)).toEqual(new IwlsError("transient", "HTTP 503"));
  });
});

describe("the redistribution boundary", () => {
  // CHS's terms forbid redistributing its predictions, so nothing that serves predictions (the
  // API, the CLI, the npm packages) may reach an IWLS client, directly or through a benchmark.
  test("no npm package reaches an IWLS client", () => {
    const root = join(import.meta.dirname, "..");
    const files = readdirSync(join(root, "packages"), {
      recursive: true,
      encoding: "utf-8",
    }).filter((path) => !/(^|\/)(node_modules|dist)\//.test(path));
    const sources = files.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
    // Package manifests can alias a benchmark through "imports" or "exports".
    const manifests = files.filter((path) => /(^|\/)package\.json$/.test(path));
    // A scan that matched nothing would pass vacuously.
    expect(sources).toContain("cli/bin/slackwater.js");
    expect(manifests).toContain("cli/package.json");
    // CHS serves IWLS from both hosts.
    const hosts = ["api-iwls.dfo-mpo", "api-sine.dfo-mpo"];
    const read = (path: string) => readFileSync(join(root, "packages", path), "utf-8");
    const offenders = [
      ...sources.filter((path) => {
        const source = read(path);
        return (
          /(from|import|require)\s*\(?\s*["'`][^"'`]*(benchmarks\/|\/iwls(\.[cm]?[jt]s)?["'`])/.test(
            source,
          ) || hosts.some((host) => source.includes(host))
        );
      }),
      ...manifests.filter((path) => /benchmarks\/|\/iwls\b/.test(read(path))),
    ];
    expect(offenders).toEqual([]);
  });
});

describe("the client", () => {
  test("waits out rate limits and server errors, then decodes grid samples", async () => {
    const server = fakeServer([429, 503, 200], {
      retryAfter: "90",
      body: [
        { eventDate: "1970-01-01T00:00:00Z", value: 2 },
        { eventDate: "1970-01-01T00:01:00Z", value: 3 },
      ],
    });
    const samples = await server.client.series("wlp", "resolved", { start: 0, end: 900_000 });
    expect(samples).toEqual<Sample[]>([{ t: 0, v: 2 }]);
    expect(server.delays).toEqual([90, 90]);
    expect(new Set(server.urls).size).toBe(1);
  });

  test("retries an empty response", async () => {
    // A 200 with no body is the contract's empty response, transient as Swift's zeroByteResource is.
    const delays: number[] = [];
    let requests = 0;
    const client = createClient({
      pacer: new Pacer(0),
      sleep: async (seconds) => {
        delays.push(seconds);
      },
      fetch: async () => new Response(++requests < 3 ? "" : "[]"),
    });
    expect(await client.stationList()).toEqual([]);
    expect(delays).toEqual([2, 4]);
  });

  test("stops after four attempts with a transient error", async () => {
    const server = fakeServer([500, 500, 500, 500]);
    await expect(server.client.stationList()).rejects.toEqual(
      new IwlsError("transient", "HTTP 500"),
    );
    expect(server.urls).toHaveLength(4);
    expect(server.delays).toEqual([2, 4, 8]);
  });

  test("fails a client error at once as permanent", async () => {
    const server = fakeServer([404]);
    await expect(server.client.stationList()).rejects.toEqual(
      new IwlsError("permanent", "HTTP 404"),
    );
    expect(server.delays).toEqual([]);
  });

  test("retries a dropped link but not a TLS failure", async () => {
    const dropped = fakeServer([fetchFailed("ECONNRESET"), 200]);
    expect(await dropped.client.stationList()).toEqual([]);
    expect(dropped.delays).toEqual([2]);
    const tls = fakeServer([fetchFailed("CERT_HAS_EXPIRED")]);
    await expect(tls.client.stationList()).rejects.toThrow("fetch failed");
    expect(tls.delays).toEqual([]);
  });

  test("ignores Retry-After headers it cannot sleep for", async () => {
    for (const header of [
      "nan",
      "Infinity",
      "-5",
      " 5",
      "0b1111111111",
      "Wed, 21 Oct 2026 07:28:00 GMT",
    ]) {
      const server = fakeServer([429, 200], { retryAfter: header });
      await server.client.stationList();
      expect(server.delays, header).toEqual([60]);
    }
  });

  test("caps a long Retry-After at 600 seconds", async () => {
    const server = fakeServer([429, 200], { retryAfter: "3600" });
    await server.client.stationList();
    expect(server.delays).toEqual([600]);
  });

  test("reads the station time zone and current axes from metadata", async () => {
    const server = fakeServer([200], {
      body: { timeZoneCode: "Canada/Pacific", floodDirection: 45, ebbDirection: null },
    });
    expect(await server.client.metadata("a/b")).toEqual({
      timeZoneCode: "Canada/Pacific",
      floodDirection: 45,
      ebbDirection: undefined,
    });
    expect(new URL(server.urls[0]).pathname).toBe("/api/v1/stations/a%2Fb/metadata");
  });

  test("paces retry attempts as well as first attempts", async () => {
    const server = fakeServer([503, 200], { pacer: new Pacer(50) });
    const began = performance.now();
    await server.client.stationList();
    expect(performance.now() - began).toBeGreaterThanOrEqual(49);
  });

  test("admits waiters one at a time even after the event loop stalls", async () => {
    const p = new Pacer(50);
    const admitted: number[] = [];
    const waits = [p.wait(), p.wait()].map((w) => w.then(() => admitted.push(performance.now())));
    const stall = performance.now() + 130;
    while (performance.now() < stall); // a synchronous block longer than both slots
    await Promise.all(waits);
    expect(admitted[1] - admitted[0]).toBeGreaterThanOrEqual(49);
  });

  test("never admits a request before its interval has passed", async () => {
    // Node schedules timers on a whole-millisecond loop clock, so a bare
    // setTimeout can fire just short of the gap performance.now() asked for.
    const p = new Pacer(3);
    const admitted: number[] = [];
    for (let i = 0; i < 40; i++) {
      await p.wait();
      admitted.push(performance.now());
    }
    const gaps = admitted.slice(1).map((t, i) => t - admitted[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
  });

  test("a cancelled waiter gives up its slot", async () => {
    const p = new Pacer(300);
    const began = performance.now();
    await p.wait();
    const controller = new AbortController();
    const cancelled = p.wait(controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    await p.wait();
    const elapsed = performance.now() - began;
    expect(elapsed).toBeGreaterThanOrEqual(299);
    // A held slot would put the third start at 600 ms; the gap absorbs a busy CI runner.
    expect(elapsed).toBeLessThan(550);
  });

  test("cancellation interrupts a backoff and sends nothing more", async () => {
    let requests = 0;
    const client = createClient({
      pacer: new Pacer(0),
      fetch: async () => {
        requests++;
        return new Response("[]", { status: 429, headers: { "Retry-After": "600" } });
      },
    });
    const controller = new AbortController();
    const pending = client.stationList(controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
    expect(requests).toBe(1);
    await expect(client.stationList(AbortSignal.abort())).rejects.toThrow();
    expect(requests).toBe(1);
  });

  test("bounds the default fetch and forwards caller cancellation", async () => {
    const request = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", request);
    const deadlines = vi.spyOn(AbortSignal, "timeout");
    try {
      const client = createClient({ pacer: new Pacer(0) });
      expect(await client.stationList()).toEqual([]);
      const controller = new AbortController();
      expect(await client.stationList(controller.signal)).toEqual([]);
      const options = request.mock.calls as unknown as [URL, { signal: AbortSignal }][];
      expect(options[0][1].signal.aborted).toBe(false);
      expect(deadlines).toHaveBeenCalledTimes(2);
      expect(deadlines).toHaveBeenNthCalledWith(1, 300_000);
      expect(deadlines).toHaveBeenNthCalledWith(2, 300_000);
      controller.abort();
      expect(options[1][1].signal.aborted).toBe(true);
    } finally {
      deadlines.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test("shares one pacer between default clients", () => {
    expect(createClient().pacer).toBe(pacer);
    expect(createClient({ fetch: async () => new Response("[]") }).pacer).toBe(pacer);
    expect(pacer.interval).toBe(2500);
  });
});

function fetchFailed(code: string) {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

function fakeServer(
  replies: (number | Error)[],
  options: { retryAfter?: string; body?: unknown; pacer?: Pacer } = {},
) {
  const urls: string[] = [];
  const delays: number[] = [];
  const client = createClient({
    pacer: options.pacer ?? new Pacer(0),
    sleep: async (seconds) => {
      delays.push(seconds);
    },
    fetch: async (url) => {
      urls.push(String(url));
      const reply = replies.shift();
      if (reply === undefined) throw new Error("no reply left");
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(options.body ?? []), {
        status: reply,
        headers: options.retryAfter === undefined ? {} : { "Retry-After": options.retryAfter },
      });
    },
  });
  return { client, urls, delays };
}

describe("cache and recipe grid contract", () => {
  test("uses every supported recipe resolution and rejects unsupported steps", () => {
    for (const row of fixture.sampleGrids) {
      expect(resolutionFor(row.minutes)).toBe(row.resolution);
      expect(onGrid(row.input, row.minutes)).toEqual(row.expected);
      expect(
        dataURL("wlp", "resolved", { start: 0, end: 900_000 }, row.minutes).searchParams.get(
          "resolution",
        ),
      ).toBe(row.resolution);
    }
    for (const minutes of fixture.unsupportedSampleMinutes) {
      expect(() => resolutionFor(minutes)).toThrow(IwlsError);
      expect(() => onGrid([], minutes)).toThrow(IwlsError);
    }
  });

  test("shares endpoint validation, negative expiry, and step identity", () => {
    for (const row of fixture.chunkCache) {
      const chunk = { start: row.startMs, end: row.endMs };
      expect(canCache(chunk, row.samples, row.storedSampleMinutes), row.name).toBe(row.canCache);
      const entry = cacheEntry(chunk, row.samples, row.storedSampleMinutes, row.fetchedAtMs);
      expect(entry !== undefined, row.name).toBe(row.canCreate);
      expect(
        entry !== undefined && isReusable(entry, chunk, row.sampleMinutes, row.nowMs),
        row.name,
      ).toBe(row.reusable);
    }
  });

  test("requests and filters the consumer recipe grid", async () => {
    const server = fakeServer([200], {
      body: [
        { eventDate: "1970-01-01T00:01:00Z", value: 1 },
        { eventDate: "1970-01-01T00:05:00Z", value: 2 },
      ],
    });
    expect(
      await server.client.series("wlp", "id", { start: 0, end: 900_000 }, undefined, 5),
    ).toEqual([{ t: 300_000, v: 2 }]);
    expect(new URL(server.urls[0]).searchParams.get("resolution")).toBe("FIVE_MINUTES");
    await expect(
      server.client.series("wlp", "id", { start: 0, end: 900_000 }, undefined, 2),
    ).rejects.toThrow(IwlsError);
    expect(server.urls).toHaveLength(1);
  });

  test("cached metadata cannot promote an incomplete week or a different identity", () => {
    const chunk = { start: 0, end: 604_800_000 };
    const entry = cacheEntry(
      chunk,
      [
        { t: 0, v: 1 },
        { t: chunk.end, v: 1 },
      ],
      15,
      0,
    )!;
    expect(isReusable({ ...entry, samples: [{ t: 0, v: 1 }] }, chunk, 15, 1)).toBe(false);
    expect(isReusable(entry, { start: chunk.end, end: chunk.end * 2 }, 15, 1)).toBe(false);
    expect(cacheEntry(chunk, [{ t: 0, v: Number.NaN }], 15, 0)).toBeUndefined();
    expect(cacheEntry(chunk, [], 15, Number.NaN)).toBeUndefined();
    expect(isReusable({ ...entry, fetchedAtMs: Number.NaN }, chunk, 15, 1)).toBe(false);
    expect(isReusable({ ...entry, endMs: 1 }, chunk, 15, 1)).toBe(false);
    expect(isReusable({ ...entry, startMs: 1, endMs: 2 }, { start: 1, end: 2 }, 15, 1)).toBe(false);
  });
});
