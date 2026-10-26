import { Body, Observer, SearchRiseSet } from "astronomy-engine";

const HOUR = 3_600_000;

function parts(time: number, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(time);
  const get = (type: string) => Number(p.find((x) => x.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's offset from UTC at `time`, in ms. */
function offset(time: number, timeZone: string): number {
  const p = parts(time, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (time - (time % 1000));
}

/** The station-local date containing `time`, as UTC midnight of that date. */
function localDate(time: number, timeZone: string): number {
  const p = parts(time, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day);
}

/**
 * The first instant of the station-local civil day containing `time`:
 * midnight, or the DST change itself where clocks skip midnight.
 */
export function startOfDay(time: number, timeZone: string): number {
  const date = localDate(time, timeZone);
  // Resolve twice so a DST change between the guess and midnight settles.
  const guess = date - offset(date, timeZone);
  const midnight = date - offset(guess, timeZone);
  if (localDate(midnight, timeZone) === date && localDate(midnight - 1000, timeZone) < date) {
    return midnight;
  }
  // Midnight is in a DST gap, so find the first second carrying this date. Local
  // dates never decrease, and offsets stay within -12 h and +14 h of UTC.
  let before = date - 15 * HOUR;
  let on = date + 12 * HOUR;
  while (on - before > 1000) {
    const mid = before + Math.floor((on - before) / 2000) * 1000;
    if (localDate(mid, timeZone) < date) before = mid;
    else on = mid;
  }
  return on;
}

/** The start of the station-local day after the one containing `time` (23 or 25 h on DST days). */
export function nextDay(time: number, timeZone: string): number {
  // No civil day is longer than 25 h, so 26 h on always lands in a later day.
  return startOfDay(startOfDay(time, timeZone) + 26 * HOUR, timeZone);
}

/** The app's chart clock, in the reader's locale and the station's zone: "4:22 PM". */
export function chartTime(time: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(
    time,
  );
}

/**
 * The lead's date and time: "Sep 20 · 4:22 PM". A figure space pads a
 * one-digit hour so the centered clock doesn't shift crossing 9:59 to 10:00.
 */
export function leadTime(time: number, timeZone: string, locale?: string): string {
  const clock = chartTime(time, timeZone, locale);
  const padded = /^\d\D/.test(clock) ? "\u2007" + clock : clock;
  return `${shortDate(time, timeZone, locale)} · ${padded}`;
}

/** "Today", "Tomorrow", "Yesterday", or the short weekday. */
export function dayLabel(dayStart: number, now: number, timeZone: string, locale?: string): string {
  const today = startOfDay(now, timeZone);
  const days = Math.round((dayStart - today) / (24 * HOUR));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" }).format(dayStart);
}

export function shortDate(time: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }).format(time);
}

/** The date, clock, and zone a screen reader hears: "Oct 14, 4:22 PM PDT". */
export function spokenTime(time: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(time);
}

/** Station-local noon of the civil day starting at `dayStart`, which is 11 or 13 h in on DST days. */
export function localNoon(dayStart: number, timeZone: string): number {
  return localDate(dayStart, timeZone) + 12 * HOUR - offset(dayStart + 12 * HOUR, timeZone);
}

export interface Day {
  start: number;
  end: number;
  sunrise?: number;
  sunset?: number;
}

/** The civil days overlapping [start, end), each with its sunrise and sunset when the sun has them. */
export function days(
  start: number,
  end: number,
  timeZone: string,
  latitude: number,
  longitude: number,
): Day[] {
  const observer = new Observer(latitude, longitude, 0);
  const result: Day[] = [];
  for (let d = startOfDay(start, timeZone); d < end; d = nextDay(d, timeZone)) {
    const e = nextDay(d, timeZone);
    const rise = SearchRiseSet(Body.Sun, observer, +1, new Date(d), (e - d) / (24 * HOUR));
    const set = SearchRiseSet(Body.Sun, observer, -1, new Date(d), (e - d) / (24 * HOUR));
    result.push({
      start: d,
      end: e,
      sunrise: rise && rise.date.getTime() < e ? rise.date.getTime() : undefined,
      sunset: set && set.date.getTime() < e ? set.date.getTime() : undefined,
    });
  }
  return result;
}

export interface Band {
  from: number;
  to: number;
  night: boolean;
}

/** Daylight from each sunrise to the sunset that follows it, and night from each sunset to the next sunrise. */
export function sunBands(list: Day[]): Band[] {
  const events = list
    .flatMap((d) => [
      ...(d.sunrise === undefined ? [] : [{ time: d.sunrise, rise: true }]),
      ...(d.sunset === undefined ? [] : [{ time: d.sunset, rise: false }]),
    ])
    .sort((a, b) => a.time - b.time);
  return events.flatMap((a, i) => {
    const b = events[i + 1];
    return b && b.rise !== a.rise ? [{ from: a.time, to: b.time, night: !a.rise }] : [];
  });
}

/** Where a day's name centers: the middle of the daylight that begins that day, else local noon. */
export function dayAnchor(day: Day, bands: Band[], timeZone: string): number {
  const light = bands.find((b) => !b.night && b.from === day.sunrise);
  return light ? (light.from + light.to) / 2 : localNoon(day.start, timeZone);
}
