import { expect, test, vi } from "vitest";

vi.mock("@slackwater/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@slackwater/database")>();
  const db = await original.loadStations();
  const identity = db.accepted.find(
    (s) => s.kind === "tide" && !s.harmonic_constituents.length && !s.offsets,
  )!;
  const sourceModel = db.accepted.find(
    (s) => s.kind === "tide" && s.harmonic_constituents.length > 0 && s.license.commercial_use,
  )!;
  const model = {
    ...sourceModel,
    id: "test/commercial",
    source: { ...sourceModel.source, id: "commercial" },
  };
  const former = { ...model, id: "test/superseded", quality: { redundant: identity.id } };
  const noncommercial = {
    ...model,
    id: "test/noncommercial",
    source: { ...model.source, id: "noncommercial" },
    license: { ...model.license, commercial_use: false },
  };
  const commercialFormer = {
    ...model,
    id: "test/commercial-former",
    source: { ...model.source, id: "commercial-former" },
    license: { ...model.license, commercial_use: true },
    quality: { redundant: noncommercial.id },
  };
  const noncommercialFormer = {
    ...model,
    id: "test/noncommercial-former",
    source: { ...model.source, id: "noncommercial-former" },
    license: { ...model.license, commercial_use: false },
    quality: { redundant: model.id },
  };
  const added = [model, former, noncommercial, commercialFormer, noncommercialFormer];
  return {
    ...original,
    loadStations: async () => ({
      ...db,
      accepted: [...db.accepted, model, noncommercial],
      all: [...db.all, ...added],
      byId: (id: string) => added.find((s) => s.id === id) ?? db.byId(id),
    }),
  };
});

import { findStation } from "../src/index.js";

test("does not replace a former tide model with an identity-only record", async () => {
  await expect(findStation("test/superseded")).rejects.toThrow("Station not found");
});

test.each(["test/commercial-former", "commercial-former"])(
  "does not downgrade commercial-use rights when resolving %s",
  async (id) => {
    await expect(findStation(id)).rejects.toThrow("Station not found");
  },
);

test.each(["test/noncommercial", "noncommercial"])(
  "still permits a direct lookup of %s",
  async (id) => {
    expect((await findStation(id)).id).toBe("test/noncommercial");
  },
);

test("permits a noncommercial former record to resolve to a commercial model", async () => {
  const station = await findStation("test/noncommercial-former");
  expect(station.id).toBe("test/commercial");
});
