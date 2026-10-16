import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  AHEAD_MS,
  BACK_MS,
  nearestEntry,
  scheduleDays,
  stationWindow,
  type ScheduleEntry,
} from "../utils/schedule.js";
import { localNoon, startOfDay } from "../utils/time.js";
import { StationDisclaimers } from "./StationDisclaimers.js";

const HOUR = 3_600_000;

export interface StationWeek {
  /** The station-local midnight the schedule's week starts on. */
  anchor?: number;
  /** The loaded window around it. */
  range?: { start: string; end: string };
  /** When the page was last shown: the Today and Tomorrow labels' now. */
  now: number;
  /** Start the week on another day. */
  pick: (anchor: number) => void;
  /** Back to this week. */
  home: () => void;
}

/** The week a station page shows and the window it loads, in the station's own days. */
export function useStationWeek(timezone: string | undefined): StationWeek {
  // A page left open for days moves its window when it is next shown two local days on.
  const [shownAt, setShownAt] = useState(() => Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setShownAt(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const today = timezone ? startOfDay(shownAt, timezone) : undefined;
  const [home, setHome] = useState<number>();
  // One day on, the loaded window still reaches 156 h ahead, and re-fetching could fail offline.
  if (today !== undefined && (home === undefined || Math.abs(today - home) > 36 * HOUR)) {
    setHome(today);
  }
  const [picked, setPicked] = useState<number>();
  const anchor = picked ?? home;
  // ponytail: a fixed online window; endless 7-day chunks come with the local engine adapter.
  const range = useMemo(() => (anchor === undefined ? undefined : stationWindow(anchor)), [anchor]);
  return {
    anchor,
    range,
    now: shownAt,
    pick: useCallback((day: number) => setPicked(day === home ? undefined : day), [home]),
    home: useCallback(() => {
      setPicked(undefined);
      setShownAt(Date.now());
    }, []),
  };
}

/** The schedule and the scrubber, kept in step: the row nearest the selection lights, and a row moves it. */
export function useScheduleSync(
  entries: ScheduleEntry[] | undefined,
  week: StationWeek,
  timezone: string | undefined,
) {
  const days = useMemo(
    () =>
      entries && week.anchor !== undefined && timezone
        ? scheduleDays(entries, week.anchor, timezone)
        : [],
    [entries, week.anchor, timezone],
  );
  const listed = useMemo(() => days.flatMap((d) => d.entries), [days]);
  const selected = useRef<number | undefined>(undefined);
  const [highlight, setHighlight] = useState<number>();
  useEffect(() => {
    if (selected.current !== undefined) setHighlight(nearestEntry(listed, selected.current));
  }, [listed]);
  const [moveTo, setMoveTo] = useState<{ time: number }>();
  const { pick, home } = week;

  return {
    days,
    highlight,
    moveTo,
    onSelect: useCallback(
      (t: number) => {
        selected.current = t;
        setHighlight(nearestEntry(listed, t));
      },
      [listed],
    ),
    onRow: useCallback((t: number) => setMoveTo({ time: t }), []),
    onPick: useCallback(
      (day: number) => {
        pick(day);
        const t = selected.current;
        // A pick that already holds the selection leaves it be, so it can stay on now.
        if (timezone && (t === undefined || t < day - BACK_MS || t > day + AHEAD_MS)) {
          setMoveTo({ time: localNoon(day, timezone) });
        }
      },
      [pick, timezone],
    ),
    onNow: home,
  };
}

export interface StationPageProps {
  name?: string;
  region?: string;
  className?: string;
  children: ReactNode;
}

/** A station's detail page on the canvas: the name over the strip, then the caller's sections. */
export function StationPage({ name, region, className, children }: StationPageProps) {
  return (
    <section
      className={`pb-[42px] text-white ${className ?? ""}`}
      style={
        {
          background: "var(--sw-background, #05122a)",
          fontFamily: "var(--sw-font-sans, system-ui, sans-serif)",
          // The strip lets the glow through; it paints its own water.
          "--sw-strip-ground": "transparent",
        } as CSSProperties
      }
    >
      <header className="px-4 pt-5 pb-4 text-center">
        <h1 className="m-0 text-[28px] leading-tight font-normal">{name ?? " "}</h1>
        <p className="m-0 mt-0.5 text-xs text-(--sw-foam)/55">{region ?? " "}</p>
      </header>
      {children}
    </section>
  );
}

export interface StationFooterProps {
  provenance?: string;
  disclaimers?: string;
  attribution?: string;
}

/** Where the numbers come from, under the safety label. */
export function StationFooter({ provenance, disclaimers, attribution }: StationFooterProps) {
  return (
    <footer className="mt-3.5 flex flex-col items-center gap-1.5 px-6 pt-2 text-center text-[11px]">
      <p className="m-0 font-mono font-medium tracking-[1.4px] text-(--sw-foam)/62 uppercase">
        Predictions — not for navigation
      </p>
      {provenance && <p className="m-0 text-(--sw-foam)/30">{provenance}</p>}
      <StationDisclaimers disclaimers={disclaimers} />
      {attribution && <p className="m-0 text-(--sw-foam)/62">{attribution}</p>}
    </footer>
  );
}

/** The collapsed provenance section, for the reader who wants to know. */
export function StationDetails({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-3.5 px-6 text-[15px] text-(--sw-foam)/70">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        Station details
        <svg
          width={11}
          height={11}
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="text-(--sw-foam)/55 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </summary>
      <div className="flex flex-col gap-2.5 pt-2 pb-2">{children}</div>
    </details>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

export function DetailNote({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs text-(--sw-foam)/55">{children}</p>;
}

/** "47.602°N, 122.339°W". */
export function formatCoord(latitude: number, longitude: number): string {
  const part = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`;
  return `${part(latitude, "N", "S")}, ${part(longitude, "E", "W")}`;
}

/** Great-circle distance in whole kilometres. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/** The strip's height while it loads, so the page doesn't jump. */
export function StripPlaceholder() {
  return <div style={{ height: 396 }} aria-busy="true" />;
}
