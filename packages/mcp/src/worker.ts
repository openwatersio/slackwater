import { Catalog, ToolError, type CatalogIndex } from "./catalog.js";
import { handleRequest } from "./http.js";
import type { Station } from "@slackwater/database";
interface Assets {
  fetch(request: Request): Promise<Response>;
}
export interface WorkerEnv {
  ASSETS: Assets;
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
const catalogs = new WeakMap<Assets, Promise<Catalog>>();
async function loadCatalog(assets: Assets) {
  let pending = catalogs.get(assets);
  if (!pending) {
    pending = (async () => {
      const response = await assets.fetch(new Request("https://catalog.invalid/index.json"));
      if (!response.ok) throw new Error("Catalog unavailable");
      const index = (await response.json()) as CatalogIndex;
      return new Catalog(index, async (id) => {
        const path = index.files?.[id];
        if (!path) return undefined;
        const model = await assets.fetch(new Request(`https://catalog.invalid/${path}`));
        if (!model.ok) throw new ToolError("catalog_error", "Model asset unavailable");
        return model.json() as Promise<Station>;
      });
    })();
    catalogs.set(assets, pending);
    pending.catch(() => catalogs.delete(assets));
  }
  return pending;
}
export default {
  async fetch(request: Request, env: WorkerEnv) {
    const path = new URL(request.url).pathname;
    if (path !== "/mcp" && path !== "/health") return new Response("Not found", { status: 404 });
    try {
      const catalog = await loadCatalog(env.ASSETS);
      return await handleRequest(catalog, request, {
        rateLimit: env.RATE_LIMITER
          ? async (key) => (await env.RATE_LIMITER!.limit({ key })).success
          : undefined,
        log: (entry) => console.log(JSON.stringify(entry)),
      });
    } catch {
      return Response.json(
        { error: "Catalog unavailable" },
        { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }
  },
};
