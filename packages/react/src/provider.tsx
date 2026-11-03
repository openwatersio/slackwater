import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Units } from "./types.js";
import { getDefaultUnits } from "./utils/defaults.js";

const defaultLocale = typeof navigator !== "undefined" ? navigator.language : "en-US";

export interface SlackwaterConfig {
  baseUrl: string;
  units: Units;
  timezone?: string;
  locale: string;
}

export type SlackwaterConfigUpdater = (
  patch: Partial<Pick<SlackwaterConfig, "units" | "timezone" | "locale">>,
) => void;

interface SlackwaterContextValue {
  config: SlackwaterConfig;
  updateConfig: SlackwaterConfigUpdater;
}

const SlackwaterContext = createContext<SlackwaterContextValue | null>(null);

const SETTINGS_KEY = "slackwater-settings";
type PersistedSettings = Partial<Pick<SlackwaterConfig, "units" | "timezone" | "locale">>;

function loadSettings(): PersistedSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SETTINGS_KEY) : null;
    if (!raw) return {};
    const { datum, ...settings } = JSON.parse(raw);
    // Heights are always at chart datum, so a datum an older release saved is dropped.
    if (datum !== undefined) saveSettings(settings);
    return settings;
  } catch {
    return {};
  }
}

function saveSettings(settings: PersistedSettings): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    // Ignore localStorage errors (quota, SSR, etc.)
  }
}

/** Create a new QueryClient with the standard slackwater defaults. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let defaultQueryClient: QueryClient | null = null;

function getDefaultQueryClient(): QueryClient {
  // On the server, always return a fresh client to prevent cross-request data leakage.
  if (typeof window === "undefined") return createQueryClient();
  if (!defaultQueryClient) defaultQueryClient = createQueryClient();
  return defaultQueryClient;
}

export interface SlackwaterProviderProps {
  baseUrl: string;
  units?: Units;
  timezone?: string;
  locale?: string;
  queryClient?: QueryClient;
  children: ReactNode;
}

export function SlackwaterProvider({
  baseUrl,
  locale: initialLocale = defaultLocale,
  units: initialUnits = getDefaultUnits(initialLocale),
  timezone: initialTimezone,
  queryClient,
  children,
}: SlackwaterProviderProps) {
  // Start with empty overrides to match the server render.
  // localStorage is read in useEffect to avoid hydration mismatches.
  const [overrides, setOverrides] = useState<PersistedSettings>({});

  useEffect(() => {
    const saved = loadSettings();
    if (Object.keys(saved).length > 0) {
      setOverrides(saved);
    }
  }, []);

  const config = useMemo<SlackwaterConfig>(
    () => ({
      baseUrl,
      units: overrides.units ?? initialUnits,
      timezone: overrides.timezone ?? initialTimezone,
      locale: overrides.locale ?? initialLocale,
    }),
    [baseUrl, initialUnits, initialTimezone, initialLocale, overrides],
  );

  const updateConfig = useCallback<SlackwaterConfigUpdater>((patch) => {
    setOverrides((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const contextValue = useMemo<SlackwaterContextValue>(
    () => ({ config, updateConfig }),
    [config, updateConfig],
  );

  return (
    <SlackwaterContext.Provider value={contextValue}>
      <QueryClientProvider client={queryClient ?? getDefaultQueryClient()}>
        {children}
      </QueryClientProvider>
    </SlackwaterContext.Provider>
  );
}

export function useSlackwaterConfig(): SlackwaterConfig {
  const ctx = useContext(SlackwaterContext);
  if (!ctx) {
    throw new Error("useSlackwaterConfig must be used within a <SlackwaterProvider>");
  }
  return ctx.config;
}

export function useUpdateConfig(): SlackwaterConfigUpdater {
  const ctx = useContext(SlackwaterContext);
  if (!ctx) {
    throw new Error("useUpdateConfig must be used within a <SlackwaterProvider>");
  }
  return ctx.updateConfig;
}
