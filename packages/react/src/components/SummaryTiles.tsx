import { useMemo, type ReactNode } from "react";

import { moonApsides, moonAt, moonLitPath, moonPhaseName, moonTideLabel } from "../utils/moon.js";
import type { TileContent } from "../utils/standing.js";
import { chartTime, days, nextDay, readableMoment, startOfDay } from "../utils/time.js";
import { formatCountdown } from "../utils/scrubber.js";

export interface SummaryTilesProps {
  /** The station's own number: a tide's Range or a current's Next max. Absent leaves the Moon alone. */
  primary?: TileContent;
  /**
   * The strip's selected moment. Absent, the Moon and Sun read nothing and
   * keep their size, for a server render that has no moment to claim.
   */
  time?: number;
  timezone: string;
  latitude?: number;
  longitude?: number;
  locale?: string;
  outlook?: ReactNode;
  /** Classes for the outer element, in place of the station page's `mx-4 mt-3`. */
  className?: string;
}

/** Between the strip and the schedule, after the app's summary tiles: the station's number above Moon and Sun that drives it. */
export function SummaryTiles({
  primary,
  timezone,
  latitude,
  longitude,
  locale,
  outlook,
  className = "mx-4 mt-3",
  time: given,
}: SummaryTilesProps) {
  // A value no date can hold, such as one from a malformed URL, reads as no moment.
  const time = readableMoment(given);
  const located = latitude !== undefined && longitude !== undefined;
  const day = time === undefined ? undefined : startOfDay(time, timezone);
  // A month-long search, so it runs once per local day rather than per scrub frame.
  const apsides = useMemo(() => (day === undefined ? undefined : moonApsides(day)), [day]);
  const solar = useMemo(
    () =>
      day === undefined || !located
        ? []
        : days(day, nextDay(nextDay(day, timezone), timezone), timezone, latitude, longitude),
    [day, timezone, located, latitude, longitude],
  );
  const reading = time === undefined || !apsides ? undefined : readTiles(time, apsides, solar);

  return (
    <div className={`@container/sw-summary ${className}`}>
      <div
        className={`grid items-start gap-3 ${primary ? "@min-[700px]/sw-summary:grid-cols-2" : ""}`}
      >
        {primary && (
          <Tile
            label={primary.label}
            caption={primary.caption}
            glyph={primary.marked && <SpanGlyph />}
            trailing={outlook}
          >
            <span className="text-[22px] font-medium">{primary.value}</span>
          </Tile>
        )}
        <div className={`grid min-w-0 gap-3 ${located ? "grid-cols-2" : ""}`}>
          <Tile
            label="Moon"
            caption={reading ? reading.moonCaption : ""}
            glyph={
              reading && <MoonGlyph fraction={reading.moon.fraction} waxing={reading.moon.waxing} />
            }
          >
            {/* Words, not a number, so a phase name fits on one line where a reading does. */}
            <span className="text-[17px] leading-[22px] font-medium">
              {reading ? moonPhaseName(reading.moon.phase) : "—"}
            </span>
          </Tile>
          {located && (
            <Tile label="Sun" caption={reading ? reading.daylight : ""} glyph={<SunGlyph />}>
              {/* Two lines tall whatever it reads, so a polar day or a tile with
                  no reading yet is the size of one naming a sunrise. */}
              <span className="min-h-11 text-[17px] leading-[22px] font-medium">
                {reading?.nextSun ? (
                  <>
                    {reading.nextSun.label}
                    <br />
                    {chartTime(reading.nextSun.time, timezone, locale)}
                  </>
                ) : (
                  "—"
                )}
              </span>
            </Tile>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the Moon and Sun tiles read at `time`. */
function readTiles(
  time: number,
  apsides: ReturnType<typeof moonApsides>,
  solar: ReturnType<typeof days>,
) {
  const moon = moonAt(time);
  const tide = moonTideLabel(moon.phase, time, apsides.perigee, apsides.apogee);
  const nextSun = solar
    .flatMap((d) => [
      ...(d.sunrise === undefined ? [] : [{ time: d.sunrise, label: "Sunrise" }]),
      ...(d.sunset === undefined ? [] : [{ time: d.sunset, label: "Sunset" }]),
    ])
    .sort((a, b) => a.time - b.time)
    .find((e) => e.time > time);
  const today = solar[0];
  const daylight =
    today?.sunrise !== undefined && today.sunset !== undefined
      ? `${formatCountdown(today.sunset >= today.sunrise ? today.sunset - today.sunrise : today.end - today.start - (today.sunrise - today.sunset))} daylight`
      : "—";
  return {
    moon,
    moonCaption: tide ?? `${Math.round(moon.fraction * 100)}% lit`,
    nextSun,
    daylight,
  };
}

function Tile({
  label,
  caption,
  glyph,
  children,
  trailing,
}: {
  label: string;
  caption: string;
  glyph: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="sw-card flex min-w-0 gap-3 p-3.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="font-(family-name:--sw-font-mono) text-[11px] leading-[13px] font-medium tracking-[1.6px] text-(--sw-foam)/55 uppercase">
            {label}
          </span>
          <span className="flex-1" />
          {/* A glyph's height held without one, so a Moon with no reading yet keeps its size. */}
          <span className="flex min-h-3.5 items-center text-(--sw-foam)/55" aria-hidden="true">
            {glyph}
          </span>
        </div>
        {/* Every value sits in a reading's line height, so the two tiles' captions align. */}
        <div
          className="flex min-h-7 items-center leading-7 text-white tabular-nums"
          style={{ fontFamily: "var(--sw-font-rounded, ui-rounded, system-ui, sans-serif)" }}
        >
          {children}
        </div>
        {/* Its line held when empty, so a tile with no reading yet is the size it will be. */}
        <p className="m-0 min-h-4 text-xs text-(--sw-foam)/55 tabular-nums">{caption}</p>
      </div>
      {trailing}
    </div>
  );
}

function SunGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      aria-hidden="true"
    >
      <circle cx={7} cy={7} r={3} />
      <path d="M7 0v2m0 10v2M0 7h2m10 0h2M2 2l1.5 1.5m7 7L12 12M2 12l1.5-1.5m7-7L12 2" />
    </svg>
  );
}

/** SF Symbols `arrow.up.and.down`: this reading is marked against its fortnight. */
function SpanGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 1.5v9M3.5 4 6 1.5 8.5 4M3.5 8 6 10.5 8.5 8" />
    </svg>
  );
}

/** The app's moon glyph: the lit shape over a faint dark disc, lit on the right while waxing. */
export function MoonGlyph({
  fraction,
  waxing,
  size = 14,
}: {
  fraction: number;
  waxing: boolean;
  size?: number;
}) {
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}>
      <circle r={r} fill="var(--sw-moon-limb)" fillOpacity={0.18} />
      <path
        d={moonLitPath(fraction, r)}
        fill="var(--sw-foam)"
        transform={waxing ? undefined : "scale(-1 1)"}
      />
      <circle r={r - 0.375} fill="none" stroke="white" strokeOpacity={0.25} strokeWidth={0.75} />
    </svg>
  );
}
