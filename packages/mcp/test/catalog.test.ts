import { expect, test, vi } from "vitest";
import { buildCatalog, generateCatalog } from "../src/generate.js";
import { Catalog } from "../src/catalog.js";
import { station, versions } from "./fixtures.js";
import fs from "node:fs/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("permission gates cover selected models and subordinate references without leaking them", async () => {
  const nc = station("test/nc", { license: { type: "CC BY-NC", commercial_use: false, url: "" } });
  const missing = station("test/missing", {
    license: { type: "unknown", url: "" } as typeof nc.license,
  });
  const sub = station("test/sub", {
    kind: "current",
    harmonic_constituents: [],
    current: { offsets: { reference: nc.id } },
  });
  const chs = station("chs-gate", {
    kind: "current",
    source: {
      name: "Canadian Hydrographic Service",
      id: "chs",
      url: "",
      published_harmonics: false,
    },
  });
  const built = buildCatalog([station(), nc, missing, sub, chs], versions);
  expect([...built.models.keys()]).toEqual(["test/port"]);
  const catalog = new Catalog(built.index, async (id) => built.models.get(id));
  for (const id of [nc.id, missing.id, sub.id, chs.id]) {
    expect(catalog.station(id).predictions).toBe(false);
    expect(catalog.station(id)).not.toHaveProperty("harmonic_constituents");
    await expect(catalog.model(id)).rejects.toThrow();
  }
});

test("canonical replacement preserves permissions and uses replacement metadata", () => {
  const old = station("test/old", {
    quality: { id: "test/old", accepted: false, score: 0, redundant: "test/new" },
  });
  const replacement = station("test/new", { chart_datum: "LAT", name: "New Port" });
  const built = buildCatalog([old, replacement], versions);
  const catalog = new Catalog(built.index, async (id) => built.models.get(id));
  expect(catalog.station(old.id)).toMatchObject({
    id: "test/new",
    requested_id: "test/old",
    chart_datum: "LAT",
  });
  expect(catalog.find({ query: "old", kind: "tide" }).stations).toHaveLength(0);
  replacement.license.commercial_use = false;
  expect(buildCatalog([old, replacement], versions).index.aliases).toEqual({});
});

test("discovery ranks exact names, handles accents, and lists bins once", () => {
  const records = [
    station("test/b", { name: "Port North" }),
    station("test/a", { name: "Pórt" }),
    station("test/c", { name: "South Port" }),
    station("test/current", { name: "Gate", kind: "current" }),
    station("test/current@2", { name: "Gate", kind: "current" }),
  ];
  const built = buildCatalog(records, versions);
  const catalog = new Catalog(built.index, async (id) => built.models.get(id));
  expect(catalog.find({ query: "port", kind: "tide" }).stations.map((s) => s.id)).toEqual([
    "test/a",
    "test/b",
    "test/c",
  ]);
  expect(catalog.find({ query: "gate", kind: "current" }).stations.map((s) => s.id)).toEqual([
    "test/current",
  ]);
  expect(catalog.station("test/current").bins).toEqual(["test/current", "test/current@2"]);
  expect(() => catalog.station("test/current@99")).toThrow(/Available.*@2/);
  expect(() => catalog.station("current")).toThrow(/not found/);
});

test("nearby results respect radius, distance ordering and stable ties", () => {
  const built = buildCatalog(
    [station("test/far", { latitude: 0 }), station("test/b"), station("test/a")],
    versions,
  );
  const catalog = new Catalog(built.index, async (id) => built.models.get(id));
  expect(
    catalog
      .find({ kind: "tide", latitude: 48, longitude: -123, radius_nm: 50 })
      .stations.map((s) => s.id),
  ).toEqual(["test/a", "test/b"]);
});

test("generation is deterministic, encodes IDs, and retains the previous manifest on bad input", async () => {
  const path = await mkdtemp(join(tmpdir(), "mcp-catalog-"));
  try {
    const records = [
      station("test/港@2"),
      station("test/a"),
      station("test/old-b", {
        quality: { id: "test/old-b", accepted: false, score: 0, redundant: "test/a" },
      }),
      station("test/old-a", {
        quality: { id: "test/old-a", accepted: false, score: 0, redundant: "test/a" },
      }),
    ];
    const a = await generateCatalog(records, versions, path);
    const previous = await readFile(join(path, "index.json"), "utf8");
    await generateCatalog([...records].reverse(), versions, path);
    expect(await readFile(join(path, "index.json"), "utf8")).toBe(previous);
    expect(a.files!["test/港@2"].split("/").at(-1)).toBe("dGVzdC_muK9AMg.json");
    await expect(generateCatalog([records[0], records[0]], versions, path)).rejects.toThrow(
      /Duplicate/,
    );
    expect(await readFile(join(path, "index.json"), "utf8")).toBe(previous);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test.each(["tide", "current"] as const)(
  "%s permission checks cover direct, missing and forbidden reference models",
  async (kind) => {
    const ref = station("test/ref", { kind });
    const sub = station("test/sub", {
      kind,
      harmonic_constituents: [],
      ...(kind === "current"
        ? { current: { offsets: { reference: ref.id } } }
        : {
            offsets: {
              reference: ref.id,
              height: { type: "ratio", high: 1, low: 1 },
              time: { high: 0, low: 0 },
            },
          }),
    });
    const built = buildCatalog([ref, sub], versions);
    expect(built.models.has(sub.id)).toBe(true);
    for (const bad of [
      undefined,
      { ...ref, harmonic_constituents: [] },
      { ...ref, kind: kind === "tide" ? ("current" as const) : ("tide" as const) },
      { ...ref, quality: { id: ref.id, accepted: false, score: 0 } },
      { ...ref, license: { ...ref.license, commercial_use: false } },
      { ...ref, source: { ...ref.source, name: "Canadian Hydrographic Service" } },
    ]) {
      expect(buildCatalog([sub, ...(bad ? [bad] : [])], versions).models.has(sub.id)).toBe(false);
    }
    expect(
      buildCatalog([station("test/empty", { kind, harmonic_constituents: [] })], versions).models
        .size,
    ).toBe(0);
  },
);

test("catalog errors refuse missing and mismatched model records", async () => {
  const built = buildCatalog([station()], versions);
  await expect(new Catalog(built.index, async () => undefined).model("test/port")).rejects.toThrow(
    /does not match/,
  );
  await expect(
    new Catalog(built.index, async () => station("test/wrong")).model("test/port"),
  ).rejects.toThrow(/does not match/);
});

test("search rejects ambiguous, unbounded and invalid coordinate inputs", () => {
  const built = buildCatalog([station()], versions);
  const catalog = new Catalog(built.index, async (id) => built.models.get(id));
  for (const input of [
    {},
    { query: "a" },
    { query: "port", latitude: 0 },
    { query: "port", longitude: 0 },
    { query: "x".repeat(101) },
    { query: "port", latitude: 0, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: Infinity },
    { latitude: 0, longitude: 0, radius_nm: 201 },
    { latitude: 0, longitude: 0, radius_nm: 0 },
  ])
    expect(() => catalog.find({ kind: "tide", ...input })).toThrow();
});

test.each(["constructor", "toString"])(
  "inherited alias %s is an ordinary missing station",
  (id) => {
    const built = buildCatalog([station()], versions);
    expect(() => new Catalog(built.index, async () => undefined).station(id)).toThrow(
      /Station not found/,
    );
  },
);

test("repeated generation never truncates an already published model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-atomic-"));
  try {
    const records = [station()];
    const index = await generateCatalog(records, versions, directory);
    const published = join(directory, index.files![records[0].id]);
    const previous = await readFile(published, "utf8");
    const original = fs.writeFile;
    const spy = vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      expect(args[0]).not.toBe(published);
      expect(await readFile(published, "utf8")).toBe(previous);
      return original(...args);
    });
    try {
      await generateCatalog(records, versions, directory);
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(published, "utf8")).toBe(previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
