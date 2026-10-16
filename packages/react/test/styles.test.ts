import { describe, expect, test } from "vitest";
import styles from "../src/styles.css?raw";

const sources = import.meta.glob<string>("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("styles.css", () => {
  test("every theme variable it invites overriding has a reader", () => {
    const definition = /^\s*(--sw-[\w-]+):/gm;
    const defined = [...styles.matchAll(definition)].map((m) => m[1]);
    const readers = [...Object.values(sources), styles.replace(definition, "")].join("\n");

    expect(defined.length).toBeGreaterThan(10);
    expect(defined.filter((name) => !new RegExp(`${name}(?![\\w-])`).test(readers))).toEqual([]);
  });
});
