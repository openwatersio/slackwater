import { afterEach, expect, test, vi } from "vitest";
import { loadStations } from "@slackwater/database";
import text from "../../src/formatters/text.js";
import { run } from "../helpers.js";

const db = await loadStations();
const credit = db.byId("jma/AS")!.attribution!;
afterEach(() => vi.restoreAllMocks());

test.each(["timeline", "extremes"])(
  "%s text retains the publisher's source and editing notice",
  async (command) => {
    const { stdout } = await run([
      command,
      "--station",
      "jma/AS",
      "--start",
      "2026-06-01",
      "--end",
      "2026-06-02",
    ]);
    expect(stdout).toContain(credit);
  },
);

test("station listings print a shared source notice once", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  text().listStations([db.byId("jma/AS")!, db.byId("jma/TK")!]);
  const output = log.mock.calls.flat().join("\n");
  expect(output.split(credit)).toHaveLength(2);
});

test("a longer notice already carries the database credit", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const noaa = db.byId("noaa/9414290")!;
  text().listStations([noaa, db.byId("jma/AS")!]);
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain(credit);
  expect(output.split(noaa.attribution!)).toHaveLength(2);
});
