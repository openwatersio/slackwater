import { useMemo, type ReactNode } from "react";

import { moonApsides, moonAt, moonLitPath, moonPhaseName, moonTideLabel } from "../utils/moon.js";
import type { TileContent } from "../utils/standing.js";
import { startOfDay } from "../utils/time.js";

export interface SummaryTilesProps {
  /** The station's own number: a tide's Range or a current's Next max. Absent leaves the Moon alone. */
  primary?: TileContent;
  /** The scrubber's selected moment. */
  time: number;
  timezone: string;
}

/** Between the strip and the schedule, after the app's summary tiles: the station's number beside the Moon that drives it. */
export function SummaryTiles({ primary, time, timezone }: SummaryTilesProps) {
  const moon = moonAt(time);
  const day = startOfDay(time, timezone);
  // A month-long search, so it runs once per local day rather than per scrub frame.
  const apsides = useMemo(() => moonApsides(day), [day]);
  const tide = moonTideLabel(moon.phase, time, apsides.perigee, apsides.apogee);

  return (
    <div className="mx-4 mt-3 flex items-start gap-3">
      {primary && (
        <Tile
          label={primary.label}
          caption={primary.caption}
          glyph={primary.marked && <SpanGlyph />}
        >
          <span className="text-[22px] font-medium">{primary.value}</span>
        </Tile>
      )}
      <Tile
        label="Moon"
        caption={tide ?? `${Math.round(moon.fraction * 100)}% lit`}
        glyph={<MoonGlyph fraction={moon.fraction} waxing={moon.waxing} />}
      >
        {/* Words, not a number, so a phase name fits on one line where a reading does. */}
        <span className="text-[17px] leading-[22px] font-medium">{moonPhaseName(moon.phase)}</span>
      </Tile>
    </div>
  );
}

function Tile({
  label,
  caption,
  glyph,
  children,
}: {
  label: string;
  caption: string;
  glyph: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sw-card flex min-w-0 flex-1 flex-col p-3.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] leading-[13px] font-medium tracking-[1.6px] text-(--sw-foam)/55 uppercase">
          {label}
        </span>
        <span className="flex-1" />
        <span className="flex items-center text-(--sw-foam)/55" aria-hidden="true">
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
      <p className="m-0 text-xs text-(--sw-foam)/55 tabular-nums">{caption}</p>
    </div>
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
