import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Catalog } from "./catalog.js";
import { createServer } from "./server.js";
import { maxResponseBytes } from "./tools.js";

export interface HttpOptions {
  rateLimit?: (key: string) => Promise<boolean>;
  log?: (entry: {
    tool: string | null;
    status: number;
    duration_ms: number;
    version: string;
  }) => void;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
};
function reply(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: cors });
}
export async function handleRequest(catalog: Catalog, request: Request, options: HttpOptions = {}) {
  const path = new URL(request.url).pathname;
  if (path === "/health" && request.method === "GET")
    return Response.json({ status: "ok", versions: catalog.index.versions }, { headers: cors });
  if (path !== "/mcp") return reply(404, "Not found");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply(405, "Use POST");
  if (
    options.rateLimit &&
    !(await options.rateLimit(request.headers.get("CF-Connecting-IP") ?? "local"))
  )
    return new Response("Request limit reached", {
      status: 429,
      headers: { ...cors, "Retry-After": "60" },
    });
  if (Number(request.headers.get("content-length")) > 16384)
    return reply(413, "Request body exceeds 16 KiB");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16384) {
          await reader.cancel();
          return reply(413, "Request body exceeds 16 KiB");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return reply(400, "Invalid JSON");
  }
  const server = createServer(catalog);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const started = performance.now();
  let status = 500;
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxResponseBytes) {
      status = 413;
      return reply(status, "Result exceeds 256 KiB; shorten the request");
    }
    status = response.status;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    return new Response(bytes.length ? bytes : null, { status, headers });
  } finally {
    await server.close();
    const input = parsedBody as { params?: { name?: unknown } } | null;
    const name = input?.params?.name;
    options.log?.({
      tool: typeof name === "string" && /^[a-z_]{1,64}$/.test(name) ? name : null,
      status,
      duration_ms: performance.now() - started,
      version: catalog.index.versions.server,
    });
  }
}
