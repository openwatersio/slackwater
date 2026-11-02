import { useMemo, useState } from "react";
import { useExtremes } from "../hooks/use-extremes.js";
import { dailySwingRanges, outlookWeek, outlookWindow } from "../utils/standing.js";
import { formatHeight, heightUnit } from "../utils/tide.js";
import { startOfDay } from "../utils/time.js";

export function RangeOutlook({
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
  const [held, setHeld] = useState({ anchor, week: anchor });
  const week = held.anchor !== anchor ? anchor : outlookWeek(held.week, time, timezone);
  if (held.anchor !== anchor || held.week !== week) setHeld({ anchor, week });
  const range = outlookWindow(week, timezone);
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const predictions = useExtremes({ id, ...range }, { staleTime: Infinity });
  const extremes = predictions.data?.extremes;
  const days = useMemo(
    () => dailySwingRanges(extremes ?? [], start, end, week, timezone),
    [extremes, start, end, week, timezone],
  );
  const biggest = Math.max(0.001, ...days.map((d) => d.range ?? 0));
  const selected = startOfDay(time, timezone);
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
        `${date.format(d.day)}: ${d.range === undefined ? "unavailable" : `${formatHeight(d.range, predictions.data!.units, locale)} ${heightUnit(predictions.data!.units)}`}`,
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
            opacity: d.day === selected ? 1 : 0.4,
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
