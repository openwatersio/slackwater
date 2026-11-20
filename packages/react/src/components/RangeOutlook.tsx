import { useMemo, useState } from "react";
import { useExtremes } from "../hooks/use-extremes.js";
import type { Extreme, Units } from "../types.js";
import { dailySwingRanges, outlookWeek, outlookWindow } from "../utils/standing.js";
import { formatHeight, heightUnit } from "../utils/tide.js";
import { startOfDay } from "../utils/time.js";

/** A moment, or undefined for none or for a value that isn't a finite number. */
const moment = (time: number | undefined) =>
  time !== undefined && Number.isFinite(time) ? time : undefined;

/**
 * The station-local midnight the Range tile's seven days start on. The bars
 * keep their week while the moment is in its first five days, so they don't
 * shift under a reader moving there. A moment on the sixth day or later
 * starts the week on its own day, and one before the week starts it four days
 * before the moment's day. With no `time` it is `anchor`, a station-local
 * midnight.
 */
export function useOutlookWeek(anchor: number, time: number | undefined, timezone: string): number {
  const [held, setHeld] = useState({ anchor, week: anchor });
  const at = moment(time);
  const week =
    held.anchor !== anchor || at === undefined ? anchor : outlookWeek(held.week, at, timezone);
  if (held.anchor !== anchor || held.week !== week) setHeld({ anchor, week });
  return week;
}

export interface RangeOutlookProps {
  /** The station-local midnight of the first day, from `useOutlookWeek`. */
  week: number;
  /** Highs and lows over `outlookWindow(week, timezone)`; absent draws no bars yet. */
  extremes?: Extreme[];
  /** The units of `extremes`. */
  units: Units;
  /** The strip's selected moment, whose day is drawn bright. Absent draws every day alike. */
  time?: number;
  timezone: string;
  locale?: string;
}

/** The Range tile's week: each day's biggest swing as a bar, after the app's range outlook. */
export function RangeOutlook({ week, extremes, units, time, timezone, locale }: RangeOutlookProps) {
  const range = outlookWindow(week, timezone);
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const days = useMemo(
    () => dailySwingRanges(extremes ?? [], start, end, week, timezone),
    [extremes, start, end, week, timezone],
  );
  const biggest = Math.max(0.001, ...days.map((d) => d.range ?? 0));
  const at = moment(time);
  const selected = at === undefined ? undefined : startOfDay(at, timezone);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "narrow" });
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const description = days
    .map(
      (d) =>
        `${date.format(d.day)}: ${d.range === undefined ? "unavailable" : `${formatHeight(d.range, units, locale)} ${heightUnit(units)}`}`,
    )
    .join("; ");
  return (
    <div
      className="flex h-[62px] w-[45%] shrink-0 items-end gap-[5px]"
      role="img"
      aria-label={`Daily tide ranges: ${description}`}
    >
      {days.map((d) => (
        <div
          key={d.day}
          className="flex min-w-0 flex-1 items-end self-end overflow-hidden rounded-[3px] bg-(--sw-graph-line)"
          style={{
            height: d.range === undefined ? 0 : 20 + (42 * d.range) / biggest,
            opacity: selected === undefined || d.day === selected ? 1 : 0.4,
          }}
        >
          {d.range !== undefined && (
            <span className="w-full bg-black/50 py-[3px] text-center text-[10px] leading-[14px] font-semibold text-white">
              {weekday.format(d.day)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** `<TideStation>`'s outlook, which loads its own week from the provider's source. */
export function StationRangeOutlook({
  id,
  anchor,
  time,
  timezone,
  locale,
}: {
  id: string;
  anchor: number;
  time: number;
  timezone: string;
  locale?: string;
}) {
  const week = useOutlookWeek(anchor, time, timezone);
  const predictions = useExtremes(
    { id, ...outlookWindow(week, timezone) },
    { staleTime: Infinity },
  );
  return (
    <RangeOutlook
      week={week}
      extremes={predictions.data?.extremes}
      units={predictions.data?.units ?? "meters"}
      time={time}
      timezone={timezone}
      locale={locale}
    />
  );
}
