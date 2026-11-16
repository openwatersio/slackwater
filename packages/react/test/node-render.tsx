import { renderToString } from "react-dom/server";
import type { TestProject } from "vitest/node";
import { nodeRendered } from "./scrubber-fixtures.js";

/** Server renders under Node, as a host prerenders, so the browser tests hydrate Node's own HTML and Intl output. */
export default function setup({ provide }: TestProject) {
  provide(
    "nodeHtml",
    Object.fromEntries(
      Object.entries(nodeRendered).map(([name, element]) => [name, renderToString(element())]),
    ) as Record<keyof typeof nodeRendered, string>,
  );
}

declare module "vitest" {
  export interface ProvidedContext {
    nodeHtml: Record<keyof typeof nodeRendered, string>;
  }
}
