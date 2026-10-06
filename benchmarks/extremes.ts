import { expect } from "vitest";
import { createWriteStream } from "fs";
import { join } from "path";
import { findStation } from "slackwater";
import { stations as db } from "@slackwater/database";

// Every tide station's extremes over one calendar year, checked for highs and
// lows that fail to alternate. Local only: no official data is fetched. See
// packages/engine/docs/extremes.md for what the numbers mean.

const __dirname = new URL(".", import.meta.url).pathname;
const YEAR = Number(process.env.YEAR ?? 2025);
const start = new Date(Date.UTC(YEAR, 0, 1));
const end = new Date(Date.UTC(YEAR + 1, 0, 1));
const days = (end.getTime() - start.getTime()) / 86_400_000;

// Stations from openwatersio/slackwater#219: micro-tidal Baltic and a Dutch river.
const WATCHED = [
  "ticon/vahemadal-vah-est-cmems",
  "ticon/tallinn-tal-est-cmems",
  "ticon/tallinnamadal-tal-est-cmems",
  "ticon/krimpenadlektg-kri-nld-cmems",
];

interface Stat {
  station: string;
  extremes: number;
  per_day: number;
  same_kind: number;
  min_change_m: number;
  min_gap_h: number;
}

const ids = db.filter((station) => station.kind === "tide").map((station) => station.id);
console.log(`Checking extremes alternation at ${ids.length} tide stations for ${YEAR}`);

const stats: Stat[] = [];
for (const id of ids) {
  const { extremes } = findStation(id).getExtremesPrediction({ start, end });
  let sameKind = 0;
  let minChange = Infinity;
  let minGap = Infinity;
  for (let i = 1; i < extremes.length; i++) {
    if (extremes[i].high === extremes[i - 1].high) sameKind++;
    minChange = Math.min(minChange, Math.abs(extremes[i].level - extremes[i - 1].level));
    minGap = Math.min(
      minGap,
      (extremes[i].time.getTime() - extremes[i - 1].time.getTime()) / 3.6e6,
    );
  }
  stats.push({
    station: id,
    extremes: extremes.length,
    per_day: extremes.length / days,
    same_kind: sameKind,
    min_change_m: minChange,
    min_gap_h: minGap,
  });
}

const summary = createWriteStream(join(__dirname, "extremes.csv"));
summary.write("station,extremes,per_day,same_kind,min_change_m,min_gap_h\n");
for (const s of stats) {
  summary.write(
    [
      s.station,
      s.extremes,
      s.per_day.toFixed(2),
      s.same_kind,
      s.min_change_m.toFixed(4),
      s.min_gap_h.toFixed(2),
    ].join(",") + "\n",
  );
}
summary.end();

const sameKind = stats.reduce((sum, s) => sum + s.same_kind, 0);
const stationsWithSameKind = stats.filter((s) => s.same_kind > 0).length;
console.log({ stations: stats.length, sameKind, stationsWithSameKind });
console.table(stats.filter((s) => WATCHED.includes(s.station)));

// Baseline expectation. The root finder can miss or double-count a turn where
// node corrections refresh, which leaves a few same-kind neighbours; the goal is zero.
expect(sameKind, "same-kind neighbours across all stations").toBeLessThanOrEqual(31);
