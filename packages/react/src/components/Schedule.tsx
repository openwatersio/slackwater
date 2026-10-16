import { Fragment, memo, useMemo, useRef, useState } from "react";

import { compass16 } from "../utils/current.js";
import type { ScheduleDay, ScheduleEntry } from "../utils/schedule.js";
import {
  chartTime,
  dateKey,
  dayLabel,
  dayStartOf,
  days,
  shortDate,
  solarNoon,
  weekLabel,
  type Day,
} from "../utils/time.js";
import { SetArrow } from "./CurrentScrubber.js";
import { SlackGlyph, SunPath, UpDownArrow } from "./Scrubber.js";

export interface ScheduleProps {
  /** The week's days, as `scheduleDays` groups them. */
  days: ScheduleDay[];
  timezone: string;
  latitude: number;
  longitude: number;
  /** The station-local midnight the week starts on. */
  anchor: number;
  /** For the Today and Tomorrow labels. */
  now: number;
  /** The entry nearest the scrubber's selection. */
  highlight?: number;
  locale?: string;
  /** A row was chosen: move the scrubber to its time. */
  onSelect: (time: number) => void;
  /** A date was picked: start the week on that day's midnight. */
  onPick: (anchor: number) => void;
}

const PILL =
  "inline-flex items-center gap-[3px] rounded-full px-2 py-1 font-mono text-[11px] leading-none font-medium uppercase tracking-[0.5px] text-(--sw-navy-deep)";

function Pill({ entry }: { entry: ScheduleEntry }) {
  switch (entry.pill) {
    case "high":
    case "low":
      return (
        <span
          className={`${PILL} ${entry.pill === "high" ? "bg-(--sw-graph-high)" : "bg-(--sw-graph-low)"}`}
        >
          <UpDownArrow up={entry.pill === "high"} size={10} />
          {entry.pill === "high" ? "High" : "Low"}
        </span>
      );
    case "slack":
      return (
        <span className={`${PILL} bg-(--sw-go)`}>
          <SlackGlyph />
          Slack
        </span>
      );
    default:
      return (
        <span className={`${PILL} ${entry.pill === "flood" ? "bg-(--sw-flood)" : "bg-(--sw-ebb)"}`}>
          {entry.direction !== undefined && (
            <>
              <SetArrow direction={entry.direction} size={10} />
              {compass16(entry.direction)}
            </>
          )}
          <span className="opacity-90">{entry.pill === "flood" ? "Flood" : "Ebb"}</span>
        </span>
      );
  }
}

function SunIcon({ rising }: { rising: boolean }) {
  return (
    <svg width={14} height={11} viewBox="0 0 16 12" aria-hidden="true">
      <SunPath rising={rising} />
    </svg>
  );
}

/** SF Symbol `sun.max`. */
function SunMax() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="2.3" />
      <path d="M6 .8v1.3M6 9.9v1.3M.8 6h1.3M9.9 6h1.3M2.3 2.3l.9.9M8.8 8.8l.9.9M2.3 9.7l.9-.9M8.8 3.2l.9-.9" />
    </svg>
  );
}

function Chevron({ open, className }: { open?: boolean; className: string }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

/** The week's high and low tides or slacks and maxima, a day at a time, after the app's schedule card. */
export const Schedule = memo(function Schedule({
  days: groups,
  timezone,
  latitude,
  longitude,
  anchor,
  now,
  highlight,
  locale,
  onSelect,
  onPick,
}: ScheduleProps) {
  const [open, setOpen] = useState<number | undefined>(anchor);
  const [shownAnchor, setShownAnchor] = useState(anchor);
  // A new week opens on its first day, as the app's does.
  if (shownAnchor !== anchor) {
    setShownAnchor(anchor);
    setOpen(anchor);
  }
  const sun = useMemo(() => {
    const list = groups.length
      ? days(groups[0].start, groups[groups.length - 1].start + 1, timezone, latitude, longitude)
      : [];
    return new Map(list.map((d) => [d.start, d]));
  }, [groups, timezone, latitude, longitude]);
  const picker = useRef<HTMLInputElement>(null);
  const clock = (t: number | undefined) => (t === undefined ? "—" : chartTime(t, timezone, locale));
  const label = weekLabel(anchor, now, timezone, locale);

  const sunTimes = (day: Day | undefined) => (
    <span className="flex flex-col items-end gap-px text-[11px] tabular-nums text-(--sw-sunrise)">
      <span className="flex items-center gap-1">
        <SunIcon rising />
        <span className="sr-only">Sunrise</span>
        {clock(day?.sunrise)}
      </span>
      <span className="flex items-center gap-1">
        <SunIcon rising={false} />
        <span className="sr-only">Sunset</span>
        {clock(day?.sunset)}
      </span>
    </span>
  );

  return (
    <div className="sw-card mx-4 overflow-hidden">
      <div className="relative">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-3 text-left"
          aria-label={`Showing ${label}. Choose a date.`}
          onClick={() => {
            const input = picker.current!;
            try {
              input.showPicker();
            } catch {
              input.focus();
            }
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="text-(--sw-foam)/70"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            strokeLinecap="round"
          >
            <rect x="1.5" y="2.5" width="11" height="10" rx="2" />
            <path d="M1.5 5.5h11M4.5 1v3M9.5 1v3" />
          </svg>
          <span className="text-[15px] font-semibold tabular-nums text-white">{label}</span>
          <span className="flex-1" />
          <Chevron className="text-(--sw-foam)/50" />
        </button>
        {/* The native picker opens over the bar; the bar is what readers and keyboards reach. */}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0"
          value={dateKey(anchor, timezone)}
          onChange={(e) => {
            if (e.target.value) onPick(dayStartOf(e.target.value, timezone));
          }}
        />
      </div>
      <div className="h-px bg-white/8" />
      <div className="py-1.5">
        {groups.map((group, i) => {
          const expanded = open === group.start;
          const day = sun.get(group.start);
          return (
            <Fragment key={group.start}>
              {i > 0 && <div className="h-px bg-white/8" />}
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? undefined : group.start)}
              >
                <span className="flex flex-col gap-[3px]">
                  <span className="text-xs font-semibold text-(--sw-foam)/90">
                    {dayLabel(group.start, now, timezone, locale)}
                  </span>
                  <span className="text-[11px] text-(--sw-foam)/55">
                    {shortDate(group.start, timezone, locale)}
                  </span>
                </span>
                <span className="flex-1" />
                {!expanded && sunTimes(day)}
                <Chevron open={expanded} className="text-(--sw-foam)/55" />
              </button>
              {expanded && (
                <div>
                  <div className="flex min-h-11 items-center px-3.5 py-2 text-[11px] tabular-nums">
                    <span className="flex flex-1 items-center gap-1 text-(--sw-sunrise)">
                      <SunIcon rising />
                      <span className="sr-only">Sunrise</span>
                      {clock(day?.sunrise)}
                    </span>
                    <span className="flex flex-1 items-center justify-center gap-1 text-(--sw-sun)">
                      <SunMax />
                      <span className="sr-only">Solar noon</span>
                      {clock(solarNoon(group.start, latitude, longitude))}
                    </span>
                    <span className="flex flex-1 items-center justify-end gap-1 text-(--sw-sunrise)">
                      <SunIcon rising={false} />
                      <span className="sr-only">Sunset</span>
                      {clock(day?.sunset)}
                    </span>
                  </div>
                  {group.entries.map((e) => {
                    const on = e.time === highlight;
                    return (
                      <Fragment key={`${e.time}-${e.pill}`}>
                        <div className="h-px bg-white/5.5" />
                        <button
                          type="button"
                          aria-current={on ? "true" : undefined}
                          className={`relative flex w-full cursor-pointer items-center gap-2 px-3.5 py-[9px] text-left ${on ? "bg-(--sw-go)/13" : ""}`}
                          onClick={() => onSelect(e.time)}
                        >
                          {on && <span className="absolute inset-y-0 left-0 w-0.5 bg-(--sw-go)" />}
                          <span
                            className={`min-w-[58px] font-mono text-[13px] ${on ? "text-white" : "text-(--sw-foam)/85"}`}
                          >
                            {chartTime(e.time, timezone, locale)}
                          </span>
                          <span className="flex-1" />
                          <span
                            className={`text-[15px] font-semibold tabular-nums ${e.value ? "text-white" : "text-(--sw-foam)/50"}`}
                          >
                            {e.value ?? "—"}
                          </span>
                          <span className="flex min-w-[120px] justify-end">
                            <Pill entry={e} />
                          </span>
                        </button>
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
});
