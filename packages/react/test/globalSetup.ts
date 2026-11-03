import { createApp } from "@slackwater/api";
import type { TestProject } from "vitest/node";

export default async function setup({ provide }: TestProject) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;
  provide("apiBaseUrl", baseUrl);

  return function teardown() {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      // The browser closes after this teardown, so a socket it holds open would keep close waiting forever.
      server.closeAllConnections();
    });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    apiBaseUrl: string;
  }
}
