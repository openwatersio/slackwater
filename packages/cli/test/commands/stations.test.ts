import { describe, test, expect, afterEach } from "vitest";
import nock from "nock";
import { stations as dbStations, search, near, type Station } from "@slackwater/database";
import { run } from "../helpers.js";

afterEach(() => {
  nock.cleanAll();
});

describe("slackwater stations", () => {
  test("lists stations with default limit", async () => {
    const { stdout } = await run(["stations"]);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("Name");
    expect(stdout).toContain("10 stations found");
  });

  test("searches by name", async () => {
    const { stdout } = await run(["stations", "san francisco"]);
    expect(stdout.toLowerCase()).toContain("san francisco");
  });

  test("limits results", async () => {
    const { stdout } = await run(["stations", "--limit", "3"]);
    expect(stdout).toContain("3 stations found");
  });

  test("finds stations near coordinates", async () => {
    const { stdout } = await run(["stations", "--near", "37.8,-122.5", "--limit", "2"]);
    expect(stdout).toContain("Distance");
    expect(stdout).toContain("km");
  });

  test("combines search with --near", async () => {
    const { stdout } = await run([
      "stations",
      "francisco",
      "--near",
      "37.8,-122.5",
      "--limit",
      "3",
    ]);
    expect(stdout.toLowerCase()).toContain("francisco");
    expect(stdout).toContain("km");
  });

  test("outputs JSON", async () => {
    const { stdout } = await run(["stations", "san francisco", "--limit", "2", "--format", "json"]);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
  });

  test("--all flag shows all stations", async () => {
    const { stdout } = await run(["stations", "san francisco", "--all"]);
    // Should not be limited to 10
    expect(stdout.toLowerCase()).toContain("san francisco");
    expect(stdout).toContain("stations found");
  });

  test("--all with search returns more than default limit", async () => {
    const { stdout: limited } = await run(["stations", "port", "--format", "json"]);
    const { stdout: all } = await run(["stations", "port", "--all", "--format", "json"]);
    const limitedData = JSON.parse(limited);
    const allData = JSON.parse(all);
    expect(allData.length).toBeGreaterThan(limitedData.length);
  });

  test("shows singular 'station' for single result", async () => {
    const { stdout } = await run(["stations", "--near", "37.8,-122.5", "--limit", "1"]);
    expect(stdout).toContain("1 station found");
    // Should NOT say "stations" (plural)
    expect(stdout).not.toContain("1 stations found");
  });

  test("--near JSON output includes distance", async () => {
    const { stdout } = await run([
      "stations",
      "--near",
      "37.8,-122.5",
      "--limit",
      "2",
      "--format",
      "json",
    ]);
    const data = JSON.parse(stdout);
    expect(data[0]).toHaveProperty("distance");
    expect(typeof data[0].distance).toBe("number");
  });

  test("finds stations by --ip geolocation", async () => {
    nock("https://reallyfreegeoip.org")
      .get("/json/")
      .reply(200, { latitude: 37.7749, longitude: -122.4194 });

    const { stdout } = await run(["stations", "--ip", "--limit", "3"]);
    expect(stdout).toContain("Distance");
    expect(stdout).toContain("km");
    expect(stdout).toContain("3 stations found");
  });

  test("combines search with --ip", async () => {
    nock("https://reallyfreegeoip.org")
      .get("/json/")
      .reply(200, { latitude: 37.7749, longitude: -122.4194 });

    const { stdout } = await run(["stations", "francisco", "--ip", "--limit", "3"]);
    expect(stdout.toLowerCase()).toContain("francisco");
    expect(stdout).toContain("km");
  });

  test("--all without query lists all stations", async () => {
    const { stdout } = await run(["stations", "--all", "--format", "json"]);
    const data = JSON.parse(stdout);
    expect(data.length).toBeGreaterThan(10);
  });

  test("--all --near removes limit", async () => {
    const { stdout: limited } = await run([
      "stations",
      "--near",
      "37.8,-122.5",
      "--limit",
      "2",
      "--format",
      "json",
    ]);
    const { stdout: all } = await run([
      "stations",
      "--near",
      "37.8,-122.5",
      "--all",
      "--format",
      "json",
    ]);
    const limitedData = JSON.parse(limited);
    const allData = JSON.parse(all);
    expect(allData.length).toBeGreaterThan(limitedData.length);
  });

  test("--all --near returns more than the database's default of 10", async () => {
    const { stdout } = await run([
      "stations",
      "--near",
      "37.8,-122.5",
      "--all",
      "--format",
      "json",
    ]);
    expect(JSON.parse(stdout).length).toBeGreaterThan(10);
  });

  test("--all with a query returns more than the database's default of 20", async () => {
    const { stdout } = await run(["stations", "port", "--all", "--format", "json"]);
    expect(JSON.parse(stdout).length).toBeGreaterThan(20);
  });

  test("ranks every text match by distance with --near", async () => {
    const isTide = (s: Station) => s.kind === "tide";
    const matches = new Set(
      search("port", { filter: isTide, maxResults: Infinity }).map((s) => s.id),
    );
    const [[nearest]] = near({
      latitude: 37.8,
      longitude: -122.5,
      maxResults: 1,
      filter: (s) => matches.has(s.id),
    });
    const { stdout } = await run([
      "stations",
      "port",
      "--near",
      "37.8,-122.5",
      "--limit",
      "1",
      "--format",
      "json",
    ]);
    expect(JSON.parse(stdout)[0].id).toBe(nearest.id);
  });

  test("errors on an invalid --limit", async () => {
    const { error } = await run(["stations", "--limit", "0"]);
    expect(error!.message).toBe('Invalid limit: "0". Expected a positive whole number.');
  });

  test("text output shows Country column without --near", async () => {
    const { stdout } = await run(["stations", "san francisco", "--limit", "2"]);
    expect(stdout).toContain("Country");
    expect(stdout).not.toContain("Distance");
  });

  test("throws when no stations found", async () => {
    const { error } = await run(["stations", "xyznonexistent123"]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("No stations found");
  });

  describe("excludes current stations", () => {
    // The database also carries current stations, which the tide predictor
    // can't use; every lookup mode must filter them out.
    const currentIds = new Set(dbStations.filter((s) => s.kind === "current").map((s) => s.id));
    const current = dbStations.find((s) => s.kind === "current")!;
    const hasCurrent = (data: { id: string }[]) => data.some((s) => currentIds.has(s.id));

    test("from the unfiltered list", async () => {
      const { stdout } = await run(["stations", "--all", "--format", "json"]);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
      expect(hasCurrent(data)).toBe(false);
    });

    test("from search results", async () => {
      // Searching a current station's own id must not surface it.
      const { stdout, error } = await run(["stations", current.source.id, "--format", "json"]);
      if (error) {
        expect(error.message).toContain("No stations found");
      } else {
        expect(hasCurrent(JSON.parse(stdout))).toBe(false);
      }
    });

    test("from --near results", async () => {
      const { stdout } = await run([
        "stations",
        "--near",
        `${current.latitude},${current.longitude}`,
        "--limit",
        "5",
        "--format",
        "json",
      ]);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
      expect(hasCurrent(data)).toBe(false);
    });
  });
});
