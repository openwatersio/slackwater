import { describe, test, expect, afterEach } from "vitest";
import nock from "nock";
import { search, near, type Station } from "@slackwater/database";
import { run } from "../helpers.js";

afterEach(() => {
  nock.cleanAll();
});

const span = ["--start", "2026-06-01T00:00:00Z", "--end", "2026-06-02T00:00:00Z"];

interface Event {
  time: string;
  speed: number;
  kind: "slack" | "maxFlood" | "maxEbb";
  direction?: number;
}

async function json(args: string[]) {
  const { stdout, error } = await run([...args, "--format", "json"]);
  if (error) throw error;
  return JSON.parse(stdout);
}

describe("slackwater currents", () => {
  test("lists its subcommands in help", async () => {
    const { stdout } = await run(["currents", "--help"]);
    for (const name of ["events", "timeline", "slack", "stations"]) {
      expect(stdout).toContain(name);
    }
  });

  test("defaults to events", async () => {
    const { stdout } = await run(["currents", "--station", "noaa/PUG1701", ...span]);
    expect(stdout).toContain("Deception Pass (Narrows)");
    expect(stdout).toContain("Max flood");
  });
});

describe("slackwater currents events", () => {
  test("shows slack, max flood, and max ebb with speed and direction", async () => {
    const { stdout } = await run(["currents", "events", "--station", "noaa/PUG1701", ...span]);
    expect(stdout).toContain("Deception Pass (Narrows)");
    expect(stdout).toContain("noaa/PUG1701  ·  knots  ·  flood 102°T  ·  ebb 282°T");
    expect(stdout).toContain("Slack");
    expect(stdout).toMatch(/Max flood\s*│\s*\d+\.\d kn\s*│\s*102°T/);
    expect(stdout).toMatch(/Max ebb\s*│\s*\d+\.\d kn\s*│\s*282°T/);
    // Speeds are magnitudes; the event name carries flood or ebb.
    expect(stdout).not.toContain("-");
  });

  test("outputs JSON in the API's shape", async () => {
    const data = await json(["currents", "events", "--station", "noaa/PUG1701", ...span]);
    expect(data.units).toBe("knots");
    expect(data.floodDirection).toBe(101.5);
    expect(data.ebbDirection).toBe(281.5);
    expect(data.station.id).toBe("noaa/PUG1701");
    expect(data.station.bins).toEqual([{ id: "noaa/PUG1701" }]);
    expect(data.station.predictions).toBe(true);
    expect(data).not.toHaveProperty("distance");

    const events: Event[] = data.events;
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(["slack", "maxFlood", "maxEbb"]));
    expect(events.find((e) => e.kind === "maxFlood")!.speed).toBeGreaterThan(0);
    expect(events.find((e) => e.kind === "maxFlood")!.direction).toBe(101.5);
    expect(events.find((e) => e.kind === "maxEbb")!.speed).toBeLessThan(0);
    expect(events.find((e) => e.kind === "slack")).not.toHaveProperty("direction");
  });

  test("returns only events inside start and end", async () => {
    const start = "2026-06-01T12:00:00Z";
    const end = "2026-06-01T18:00:00Z";
    const data = await json(["currents", "-s", "noaa/PUG1701", "--start", start, "--end", end]);
    const times = (data.events as Event[]).map((e) => Date.parse(e.time));
    expect(times.length).toBeGreaterThan(0);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(Date.parse(start));
    expect(Math.max(...times)).toBeLessThanOrEqual(Date.parse(end));
  });

  test("says so when no events fall in the span", async () => {
    const { stdout } = await run([
      "currents",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T12:00:00Z",
      "--end",
      "2026-06-01T12:01:00Z",
    ]);
    expect(stdout).toContain("No slack or max current in this period");
  });

  test("defaults start and end when omitted", async () => {
    const data = await json(["currents", "-s", "noaa/PUG1701"]);
    expect(data.events.length).toBeGreaterThan(0);
  });

  test("predicts a subordinate station", async () => {
    const data = await json(["currents", "-s", "noaa/ACT0091", ...span]);
    expect(data.station.type).toBe("subordinate");
    expect((data.events as Event[]).some((e) => e.kind === "maxEbb")).toBe(true);
  });

  test("omits directions the station doesn't define", async () => {
    // noaa/ACT3681 has a flood direction but no ebb direction.
    const data = await json(["currents", "-s", "noaa/ACT3681", ...span]);
    expect(data.floodDirection).toBe(10);
    expect(data).not.toHaveProperty("ebbDirection");

    const { stdout } = await run(["currents", "-s", "noaa/ACT3681", ...span]);
    expect(stdout).toContain("flood 10°T");
    expect(stdout).not.toMatch(/·  ebb/);
  });

  test("omits both directions when the station has neither", async () => {
    const data = await json(["currents", "-s", "noaa/ACT5151", ...span]);
    expect(data).not.toHaveProperty("floodDirection");
    expect((data.events as Event[]).every((e) => e.direction === undefined)).toBe(true);

    const { stdout } = await run(["currents", "-s", "noaa/ACT5151", ...span]);
    expect(stdout).not.toContain("°T");
  });

  describe("station selection", () => {
    test("finds the nearest station with --near and reports the distance", async () => {
      const data = await json(["currents", "--near", "48.406,-122.643", ...span]);
      expect(data.station.id).toBe("noaa/PUG1701");
      expect(typeof data.distance).toBe("number");

      const { stdout } = await run(["currents", "--near", "48.406,-122.643", ...span]);
      expect(stdout).toContain("km away");
    });

    test("finds the nearest station with --ip", async () => {
      nock("https://reallyfreegeoip.org")
        .get("/json/")
        .reply(200, { latitude: 48.406, longitude: -122.643 });
      const data = await json(["currents", "--ip", ...span]);
      expect(data.station.id).toBe("noaa/PUG1701");
    });

    test("selects a depth bin with @N", async () => {
      const primary = await json(["currents", "-s", "noaa/EPT0003", ...span]);
      const bin = await json(["currents", "-s", "noaa/EPT0003@11", ...span]);
      expect(primary.station.id).toBe("noaa/EPT0003");
      expect(bin.station.id).toBe("noaa/EPT0003@11");
      expect(bin.station.bins[0]).toEqual({ id: "noaa/EPT0003" });
      expect(bin.station.bins).toContainEqual({ id: "noaa/EPT0003@11", bin: 11 });
      expect(bin.events).not.toEqual(primary.events);
    });

    test("lists the available bins for an unknown bin", async () => {
      const { error } = await run(["currents", "-s", "noaa/EPT0003@99"]);
      expect(error!.message).toBe(
        "noaa/EPT0003 has no bin 99. Available bins: noaa/EPT0003, noaa/EPT0003@11",
      );
    });

    test("lists the available bins for an unknown bin of a source id", async () => {
      const { error } = await run(["currents", "-s", "EPT0003@99"]);
      expect(error!.message).toContain("noaa/EPT0003 has no bin 99. Available bins:");
    });

    test("points a tide station at the tide commands", async () => {
      const { error } = await run(["currents", "-s", "noaa/9414290"]);
      expect(error!.message).toContain("noaa/9414290 is a tide station");
    });

    test("points a tide station's source id at the tide commands", async () => {
      const { error } = await run(["currents", "-s", "9414290"]);
      expect(error!.message).toContain("9414290 is a tide station");
    });

    test("errors on an unknown station", async () => {
      const { error } = await run(["currents", "-s", "noaa/NOPE"]);
      expect(error!.message).toBe("Current station not found: noaa/NOPE");
    });

    test("errors on an unknown bin of an unknown station", async () => {
      const { error } = await run(["currents", "-s", "noaa/NOPE@3"]);
      expect(error!.message).toBe("Current station not found: noaa/NOPE@3");
    });

    test("refuses a CHS station by id", async () => {
      const { error } = await run(["currents", "-s", "chs-active-pass"]);
      expect(error!.message).toContain("Canadian Hydrographic Service");
      expect(error!.message).toContain("https://tides.gc.ca/");
    });

    test("refuses when the nearest station is a CHS station", async () => {
      // Answering for the next station out would describe a different channel.
      const { error } = await run(["currents", "--near", "48.8604,-123.3128"]);
      expect(error!.message).toContain("Predictions for Active Pass");
      expect(error!.message).toContain("Canadian Hydrographic Service");
    });

    test("refuses a station with no model by id", async () => {
      const { error } = await run(["currents", "-s", "noaa-boundary-pass"]);
      expect(error!.message).toContain("Boundary Pass has no harmonic constituents");
    });

    test("skips stations with no model when finding the nearest", async () => {
      const data = await json(["currents", "--near", "48.6912,-123.245", ...span]);
      expect(data.station.id).not.toBe("noaa-boundary-pass");
      expect(data.station.predictions).toBe(true);
    });

    test("errors without a station", async () => {
      const { error } = await run(["currents"]);
      expect(error!.message).toContain("No station specified");
    });
  });

  describe("dates", () => {
    test("errors on an invalid start", async () => {
      const { error } = await run(["currents", "-s", "noaa/PUG1701", "--start", "soon"]);
      expect(error!.message).toBe('Invalid start date: "soon"');
    });

    test("errors on an invalid end", async () => {
      const { error } = await run(["currents", "-s", "noaa/PUG1701", "--end", "later"]);
      expect(error!.message).toBe('Invalid end date: "later"');
    });

    test("errors when end is not after start", async () => {
      const { error } = await run([
        "currents",
        "-s",
        "noaa/PUG1701",
        "--start",
        "2026-06-02",
        "--end",
        "2026-06-01",
      ]);
      expect(error!.message).toBe("End date must be after start date");
    });

    test("errors on a span longer than 366 days", async () => {
      const { error } = await run([
        "currents",
        "slack",
        "-s",
        "noaa/PUG1701",
        "--start",
        "2026-01-01",
        "--end",
        "2027-01-03",
      ]);
      expect(error!.message).toBe("End date must be within 366 days of start date");
    });
  });
});

describe("slackwater currents timeline", () => {
  test("shows flood and ebb speeds", async () => {
    const { stdout } = await run(["currents", "timeline", "-s", "noaa/PUG1701", ...span]);
    expect(stdout).toContain("Current");
    expect(stdout).toMatch(/Flood\s*│\s*\d+\.\d kn/);
    expect(stdout).toMatch(/Ebb\s*│\s*\d+\.\d kn/);
  });

  test("labels samples that round to 0.0 kn as slack", async () => {
    // Deception Pass turns at about 00:05Z.
    const { stdout } = await run([
      "currents",
      "timeline",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T00:00:00Z",
      "--end",
      "2026-06-01T00:10:00Z",
      "--interval",
      "1",
    ]);
    expect(stdout).toMatch(/Slack\s*│\s*0\.0 kn/);
  });

  test("outputs JSON in the API's shape", async () => {
    const data = await json(["currents", "timeline", "-s", "noaa/PUG1701", ...span]);
    expect(data.units).toBe("knots");
    expect(data.floodDirection).toBe(101.5);
    expect(data.station.predictions).toBe(true);
    expect(data.timeline[0]).toEqual({
      time: "2026-06-01T00:00:00.000Z",
      hour: 0,
      speed: expect.any(Number),
    });
    expect(data.timeline.some((p: { speed: number }) => p.speed < 0)).toBe(true);
  });

  test("samples every --interval minutes", async () => {
    const hourly = await json(["currents", "timeline", "-s", "noaa/PUG1701", ...span]);
    const tenMinutes = await json([
      "currents",
      "timeline",
      "-s",
      "noaa/PUG1701",
      ...span,
      "--interval",
      "10",
    ]);
    expect(hourly.timeline).toHaveLength(25);
    expect(tenMinutes.timeline).toHaveLength(145);
  });

  test("errors on an invalid interval", async () => {
    const { error } = await run(["currents", "timeline", "-s", "noaa/PUG1701", "--interval", "0"]);
    expect(error!.message).toBe('Invalid interval: "0". Expected a positive whole number.');
  });

  test("errors on a fractional interval", async () => {
    const { error } = await run([
      "currents",
      "timeline",
      "-s",
      "noaa/PUG1701",
      "--interval",
      "0.001",
    ]);
    expect(error!.message).toBe('Invalid interval: "0.001". Expected a positive whole number.');
  });

  test("refuses a CHS station", async () => {
    const { error } = await run(["currents", "timeline", "-s", "chs-active-pass"]);
    expect(error!.message).toContain("Canadian Hydrographic Service");
  });
});

describe("slackwater currents slack", () => {
  test("shows windows below the threshold", async () => {
    const { stdout } = await run(["currents", "slack", "-s", "noaa/PUG1701", ...span]);
    expect(stdout).toContain("below 0.5 kn");
    expect(stdout).toContain("Duration");
    expect(stdout).toMatch(/│\s*\d+m\s*│/);
  });

  test("outputs the windows as JSON", async () => {
    const data = await json(["currents", "slack", "-s", "noaa/PUG1701", ...span]);
    expect(data.units).toBe("knots");
    expect(data.threshold).toBe(0.5);
    expect(data.station.id).toBe("noaa/PUG1701");
    expect(data.windows.length).toBeGreaterThan(0);
    for (const { start, end } of data.windows) {
      expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
    }
  });

  test("widens the windows with a higher --threshold", async () => {
    const narrow = await json(["currents", "slack", "-s", "noaa/PUG1701", ...span]);
    const wide = await json(["currents", "slack", "-s", "noaa/PUG1701", ...span, "-t", "2"]);
    const total = (windows: { start: string; end: string }[]) =>
      windows.reduce((sum, w) => sum + Date.parse(w.end) - Date.parse(w.start), 0);
    expect(total(wide.windows)).toBeGreaterThan(total(narrow.windows));
  });

  test("marks windows cut off by the start or end of the span", async () => {
    // Deception Pass turns at about 00:05Z, so a slack window is under way at 00:00Z.
    const data = await json(["currents", "slack", "-s", "noaa/PUG1701", ...span]);
    expect(data.windows[0].start).toBe("2026-06-01T00:00:00.000Z");
    expect(data.windows[0].clipped).toBe(true);
    expect(data.windows.slice(1).some((w: { clipped?: boolean }) => w.clipped)).toBe(false);

    const { stdout } = await run(["currents", "slack", "-s", "noaa/PUG1701", ...span]);
    expect(stdout).toMatch(/│\s*≥ \d+m\s*│/);
    expect(stdout).toContain("so it lasts longer than shown");
  });

  test("keeps a slack that turned before the start of the span", async () => {
    // The 00:05Z turn is already past at 00:08Z, but the water is still slack.
    const data = await json([
      "currents",
      "slack",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T00:08:00Z",
      "--end",
      "2026-06-01T01:00:00Z",
    ]);
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0].start).toBe("2026-06-01T00:08:00.000Z");
    expect(Date.parse(data.windows[0].end)).toBeGreaterThan(Date.parse("2026-06-01T00:08:00Z"));
    expect(data.windows[0].clipped).toBe(true);
  });

  test("cuts a window at the end of the span", async () => {
    const data = await json([
      "currents",
      "slack",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-05-31T23:00:00Z",
      "--end",
      "2026-06-01T00:02:00Z",
    ]);
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0].end).toBe("2026-06-01T00:02:00.000Z");
    expect(data.windows[0].clipped).toBe(true);
  });

  test("keeps windows inside a span that starts between samples", async () => {
    const data = await json([
      "currents",
      "slack",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T00:00:30Z",
      "--end",
      "2026-06-01T01:00:00Z",
    ]);
    expect(Date.parse(data.windows[0].start)).toBeGreaterThanOrEqual(
      Date.parse("2026-06-01T00:00:30Z"),
    );
  });

  test("dates the end of a window that crosses midnight", async () => {
    // Estes Head runs about 2 kn, so a 1.5 kn threshold holds for hours, across local midnight.
    const { stdout } = await run([
      "currents",
      "slack",
      "-s",
      "noaa/EPT0003",
      "--start",
      "2026-06-01T00:00:00Z",
      "--end",
      "2026-06-03T00:00:00Z",
      "-t",
      "1.5",
    ]);
    expect(stdout).toMatch(/│\s*Jun \d+, 2026 \d+:\d\d [AP]M EDT\s*│/);
  });

  test("leaves complete windows unmarked", async () => {
    const { stdout } = await run([
      "currents",
      "slack",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T03:00:00Z",
      "--end",
      "2026-06-01T08:00:00Z",
    ]);
    expect(stdout).toContain("Duration");
    expect(stdout).not.toContain("≥");
  });

  test("shows hours for windows longer than an hour", async () => {
    // Estes Head runs about 2 kn, so a 1 kn threshold holds for over an hour.
    const { stdout } = await run(["currents", "slack", "-s", "noaa/EPT0003", ...span, "-t", "1"]);
    expect(stdout).toMatch(/│\s*\dh \d\dm\s*│/);
  });

  test("says so when no window falls in the span", async () => {
    // An hour around Deception Pass's max flood never drops to slack.
    const { stdout } = await run([
      "currents",
      "slack",
      "-s",
      "noaa/PUG1701",
      "--start",
      "2026-06-01T08:30:00Z",
      "--end",
      "2026-06-01T09:00:00Z",
    ]);
    expect(stdout).toContain("No slack windows below 0.5 kn in this period");
  });

  test("errors on an invalid threshold", async () => {
    const { error } = await run(["currents", "slack", "-s", "noaa/PUG1701", "-t", "fast"]);
    expect(error!.message).toBe('Invalid threshold: "fast". Expected a positive number.');
  });
});

describe("slackwater currents stations", () => {
  test("lists current stations with their bins and whether they can be predicted", async () => {
    const { stdout } = await run(["currents", "stations"]);
    expect(stdout).toContain("Bins");
    expect(stdout).toContain("Predictions");
    expect(stdout).toContain("Country");
    expect(stdout).toContain("10 stations found");
  });

  test("searches by name", async () => {
    const { stdout } = await run(["currents", "stations", "deception"]);
    expect(stdout).toContain("noaa/PUG1701");
    expect(stdout).toContain("Deception Pass (Narrows)");
  });

  test("lists each station once, at its primary bin", async () => {
    const data = await json(["currents", "stations", "estes head", "--all"]);
    const ids = data.map((s: { id: string }) => s.id);
    expect(ids).toContain("noaa/EPT0003");
    expect(ids.some((id: string) => id.includes("@"))).toBe(false);
    const estes = data.find((s: { id: string }) => s.id === "noaa/EPT0003");
    expect(estes.bins).toContainEqual({ id: "noaa/EPT0003@11", bin: 11 });
  });

  test("flags stations that can't be predicted", async () => {
    const data = await json(["currents", "stations", "active pass"]);
    const chs = data.find((s: { id: string }) => s.id === "chs-active-pass");
    expect(chs.predictions).toBe(false);
    expect(chs.unavailable).toContain("Canadian Hydrographic Service");

    const { stdout } = await run(["currents", "stations", "active pass"]);
    expect(stdout).toMatch(/chs-active-pass.*│\s*no\s*│/);
    expect(stdout).toContain("on a station without predictions to see why");
  });

  test("finds stations near coordinates", async () => {
    const { stdout } = await run(["currents", "stations", "--near", "48.69,-123.25", "-l", "3"]);
    expect(stdout).toContain("Distance");
    expect(stdout).toContain("km");
    expect(stdout).toContain("3 stations found");
  });

  test("includes distance and flags in --near JSON", async () => {
    const data = await json(["currents", "stations", "--near", "48.406,-122.643", "-l", "2"]);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("noaa/PUG1701");
    expect(typeof data[0].distance).toBe("number");
    expect(data[0].predictions).toBe(true);
    expect(data[0].bins).toEqual([{ id: "noaa/PUG1701" }]);
  });

  test("combines search with --near", async () => {
    const data = await json(["currents", "stations", "pass", "--near", "48.406,-122.643"]);
    expect(data[0].id).toBe("noaa/PUG1701");
  });

  test("finds stations by --ip geolocation", async () => {
    nock("https://reallyfreegeoip.org")
      .get("/json/")
      .reply(200, { latitude: 48.406, longitude: -122.643 });
    const { stdout } = await run(["currents", "stations", "--ip", "-l", "1"]);
    expect(stdout).toContain("noaa/PUG1701");
    expect(stdout).toContain("1 station found");
  });

  test("--all removes the limit", async () => {
    const data = await json(["currents", "stations", "--all"]);
    expect(data.length).toBeGreaterThan(10);
    expect(data.every((s: { kind: string }) => s.kind === "current")).toBe(true);
  });

  test("--all removes the limit with --near", async () => {
    // The database caps `near` at 10 results unless told otherwise.
    const data = await json(["currents", "stations", "--near", "48.4,-122.6", "--all"]);
    expect(data.length).toBeGreaterThan(10);
  });

  test("--all removes the limit with a query", async () => {
    // The database caps `search` at 20 results unless told otherwise.
    const data = await json(["currents", "stations", "pass", "--all"]);
    expect(data.length).toBeGreaterThan(20);
  });

  test("ranks every text match by distance with --near", async () => {
    const isPass = (s: Station) => s.kind === "current" && !s.id.includes("@");
    const matches = new Set(
      search("pass", { filter: isPass, maxResults: Infinity }).map((s) => s.id),
    );
    const [[nearest]] = near({
      latitude: 47.6,
      longitude: -122.34,
      maxResults: 1,
      filter: (s) => matches.has(s.id),
    });
    const data = await json(["currents", "stations", "pass", "--near", "47.6,-122.34", "-l", "1"]);
    expect(data[0].id).toBe(nearest.id);
  });

  test("errors on an invalid --limit", async () => {
    const { error } = await run(["currents", "stations", "--limit", "abc"]);
    expect(error!.message).toBe('Invalid limit: "abc". Expected a positive whole number.');
  });

  test("errors on a --limit that only parses as a number in JavaScript", async () => {
    const { error } = await run(["currents", "stations", "--limit", "0x10"]);
    expect(error!.message).toBe('Invalid limit: "0x10". Expected a positive whole number.');
  });

  test("leaves the region blank for stations without one", async () => {
    const { stdout } = await run(["currents", "stations", "noaa/ACT8296"]);
    expect(stdout).toMatch(/noaa\/ACT8296\s*│\s*Southeast Channel\s*│\s*│/);
  });

  test("excludes tide stations", async () => {
    const { error } = await run(["currents", "stations", "9414290"]);
    expect(error!.message).toBe("No current stations found");
  });
});
