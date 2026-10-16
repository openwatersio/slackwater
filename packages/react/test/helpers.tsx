import { inject, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { SlackwaterProvider, SlackwaterProviderProps } from "../src/provider.js";
import type { ReactNode } from "react";

export function createTestWrapper({
  baseUrl = inject("apiBaseUrl"),
  ...props
}: Partial<SlackwaterProviderProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SlackwaterProvider baseUrl={baseUrl} queryClient={queryClient} {...props}>
        {children}
      </SlackwaterProvider>
    );
  };
}

/** Holds back the requests `held` matches until `release` is called; the rest go through. */
export function holdRequests(held: (url: string) => boolean) {
  const real = window.fetch.bind(window);
  const waiting: (() => void)[] = [];
  vi.spyOn(window, "fetch").mockImplementation((input, init) => {
    if (!held(String(input))) return real(input, init);
    return new Promise((resolve) => waiting.push(() => resolve(real(input, init))));
  });
  return { release: () => waiting.splice(0).forEach((go) => go()) };
}
