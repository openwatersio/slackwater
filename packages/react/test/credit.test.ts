import { describe, expect, test } from "vitest";
import { creditHtml, distinctCredits } from "../src/utils/credit.js";

const DATABASE = "Slackwater database (https://github.com/openwatersio/slackwater-database)";
const KARTVERKET = `${DATABASE}. Source: Kartverket. Licensed CC BY 4.0.`;
const TICON_NC = `${DATABASE}. Source: TICON-4. Licensed CC BY-NC 4.0.`;

describe("distinctCredits", () => {
  test("keeps each credit once, in the order first seen", () => {
    expect(distinctCredits([TICON_NC, KARTVERKET, TICON_NC, KARTVERKET])).toEqual([
      TICON_NC,
      KARTVERKET,
    ]);
  });

  test("drops a credit another contains, and blank or missing ones", () => {
    expect(distinctCredits([DATABASE, undefined, KARTVERKET, " ", ""])).toEqual([KARTVERKET]);
    expect(distinctCredits([DATABASE, DATABASE])).toEqual([DATABASE]);
    expect(distinctCredits([])).toEqual([]);
  });
});

describe("creditHtml", () => {
  test("escapes what MapLibre would read as markup", () => {
    expect(creditHtml(`A & B <i>"C"</i>`)).toBe("A &amp; B &lt;i&gt;&quot;C&quot;&lt;/i&gt;");
    expect(creditHtml(DATABASE)).toBe(DATABASE);
  });
});
