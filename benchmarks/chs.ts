import { expect } from "vitest";
import { mkdir, readFile, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { join } from "path";
import { findStation } from "slackwater";
import { loadStations } from "@slackwater/database";
import createFetch from "make-fetch-happen";

const __dirname = new URL(".", import.meta.url).pathname;
const fetch = createFetch.defaults({
  cachePath: join(__dirname, ".cache"),
  cache: "force-cache",
  retry: 10,
});

const CHS_API = "https://api-sine.dfo-mpo.gc.ca/api/v1";

// TICON ids for Canadian MEDS stations embed the CHS station code:
// "sidney_bc-7260-can-meds" -> CHS code "07260".
const { accepted: db } = await loadStations();
const stations = db
  .filter((station) => station.source.id.endsWith("-can-meds"))
  .map((station) => station.source.id);

// Create a directory for test cache
await mkdir(".test-cache", { recursive: true });

interface Stat {
  station: string;
  scheme: string;
  type: string;
  start_utc: string;
  end_utc: string;
  events_chs: number;
  events_model: number;
  matched: number;
  missed: number;
  extra: number;
  med_abs_dt_min: number;
  p95_abs_dt_min: number;
  mean_dt_min: number;
  mae_dh_m: number;
  mean_dh_m: number;
  rmse_dh_m: number;
  bias_dh_m: number;
  p95_abs_dh_m: number;
}

const stats: Stat[] = [];
const MATCH_WINDOW = 3 * 60 * 60 * 1000; // 3 hours
const scheme = (process.env.SCHEME ?? "iho") as "iho" | "schureman";
const FAST = !!process.env.FAST;
const RANGE_DAYS = FAST ? 3 : 365;

// Anchor the comparison window to the start of the current UTC month so
// cached CHS responses stay valid within a month and roll over naturally.
const now = new Date();
const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const rangeEnd = new Date(rangeStart.getTime() + RANGE_DAYS * 24 * 60 * 60 * 1000);
const stamp = rangeStart.toISOString().slice(0, 10);

console.log(
  `Testing tide predictions against ${stations.length} CHS stations (scheme=${scheme}, days=${RANGE_DAYS})`,
);

type Extreme = {
  time: number;
  level: number;
  type: "H" | "L";
};

// CHS hi/lo predictions ("wlp-hilo") are referenced to chart datum, which at
// Canadian stations is neither LAT nor MLLW (e.g. Sidney BC: 0.43 m above
// LAT). Each station's metadata carries the chart-datum -> LAT offset, so we
// shift CHS levels onto LAT and ask the model for LAT, giving both sides the
// same zero. Comparing without this mostly measures datum offsets (#223).
const heightTypes: { id: string; code: string }[] = await fetchCHS("height-types", "height-types");
const LAT_TYPE_ID = heightTypes.find((h) => h.code === "LAT")?.id;
if (!LAT_TYPE_ID) throw new Error("CHS height-types has no LAT entry");

const skipped = { noChsStation: 0, noLatDatum: 0, noPredictions: 0 };

for (const id of stations) {
  const code = id.match(/-(\d+)-can-meds$/)?.[1].padStart(5, "0");
  if (!code) continue;

  const found = await fetchCHS(`stations?code=${code}`, `station-${code}`);
  const chsStation = found?.[0];
  if (!chsStation) {
    skipped.noChsStation += 1;
    continue;
  }

  const metadata = await fetchCHS(`stations/${chsStation.id}/metadata`, `metadata-${code}`);
  const latOffset = metadata?.heights?.find(
    (h: { heightTypeId: string }) => h.heightTypeId === LAT_TYPE_ID,
  )?.value;
  if (latOffset === undefined) {
    skipped.noLatDatum += 1;
    continue;
  }
  // The metadata offset is LAT relative to chart datum (negative when LAT is
  // below it); adding the negation shifts chart-datum levels onto LAT.
  const chartDatumToLat = -latOffset;

  const query = new URLSearchParams({
    "time-series-code": "wlp-hilo",
    from: rangeStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
    to: rangeEnd.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const rows = await fetchCHS(
    `stations/${chsStation.id}/data?${query}`,
    `hilo-${code}-${stamp}-${RANGE_DAYS}d`,
  );
  if (!Array.isArray(rows) || rows.length < 2) {
    skipped.noPredictions += 1;
    continue;
  }

  // CHS rows carry no H/L type; label by comparing neighbors. Pairwise
  // comparison keeps any mislabel local if an event is ever missing, instead
  // of cascading down the rest of the sequence.
  const levels: number[] = rows.map((r: { value: string }) => parseFloat(r.value));
  const chsEvents: Extreme[] = rows.map((r: { eventDate: string }, i: number) => ({
    time: new Date(r.eventDate).getTime(),
    level: levels[i] + chartDatumToLat,
    type:
      i < levels.length - 1
        ? levels[i] > levels[i + 1]
          ? ("H" as const)
          : ("L" as const)
        : levels[i] > levels[i - 1]
          ? ("H" as const)
          : ("L" as const),
  }));

  const station = await findStation(["ticon", id].join("/"));

  // Get start/end dates to match CHS data
  const start = new Date(chsEvents[0].time - MATCH_WINDOW);
  const end = new Date(chsEvents[chsEvents.length - 1].time + MATCH_WINDOW);

  const slackwaterEvents: Extreme[] = station
    .getExtremesPrediction({
      start,
      end,
      datum: "LAT",
      nodeCorrections: scheme,
    })
    .extremes.map((e) => ({
      time: e.time.getTime(),
      level: e.level,
      type: e.high ? "H" : "L",
    }));

  let matched = 0;
  let missed = 0;
  let extra = 0;

  const dtMinutes: number[] = [];
  const dhMeters: number[] = [];

  const chs = Object.groupBy(chsEvents, (e) => e.type) as Record<"H" | "L", Extreme[] | undefined>;
  const slackwater = Object.groupBy(slackwaterEvents, (e) => e.type) as Record<
    "H" | "L",
    Extreme[] | undefined
  >;

  const matchAndCollect = (chsList: Extreme[], slackwaterList: Extreme[]) => {
    let j = 0;

    for (let i = 0; i < chsList.length; i++) {
      const chs = chsList[i];

      // Count model events that are too early to ever match this CHS event as "extra"
      while (j < slackwaterList.length && slackwaterList[j].time < chs.time - MATCH_WINDOW) {
        extra += 1;
        j += 1;
      }

      if (j >= slackwaterList.length) {
        missed += 1;
        continue;
      }

      // Consider the closest of current or next model event
      let bestIndex = j;
      let bestAbsDt = Math.abs(slackwaterList[j].time - chs.time);

      if (j + 1 < slackwaterList.length) {
        const nextAbsDt = Math.abs(slackwaterList[j + 1].time - chs.time);
        if (nextAbsDt < bestAbsDt) {
          bestIndex = j + 1;
          bestAbsDt = nextAbsDt;
        }
      }

      // If closest is outside the matching window, treat CHS event as missed
      if (bestAbsDt > MATCH_WINDOW) {
        missed += 1;
        continue;
      }

      const match = slackwaterList[bestIndex];

      // Advance pointer past the matched event (one-to-one matching)
      j = bestIndex + 1;

      matched += 1;

      const dtMin = (match.time - chs.time) / 60000;
      const dh = match.level - chs.level;

      dtMinutes.push(dtMin);
      dhMeters.push(dh);
    }

    // Any remaining model events are "extra"
    extra += Math.max(0, slackwaterList.length - j);
  };

  matchAndCollect(chs.H ?? [], slackwater.H ?? []);
  matchAndCollect(chs.L ?? [], slackwater.L ?? []);

  const events_chs = (chs.H?.length ?? 0) + (chs.L?.length ?? 0);
  const events_model = (slackwater.H?.length ?? 0) + (slackwater.L?.length ?? 0);

  // Timing metrics (minutes)
  const absDt = sort(dtMinutes.map((v) => Math.abs(v)));
  const med_abs_dt_min = ntile(absDt, 0.5);
  const p95_abs_dt_min = ntile(absDt, 0.95);
  const mean_dt_min = mean(dtMinutes);

  // Height metrics (meters) at matched events
  const absDh = dhMeters.map((v) => Math.abs(v));
  const mae_dh_m = mean(absDh);
  const mean_dh_m = mean(dhMeters);
  const rmse_dh_m = Math.sqrt(dhMeters.reduce((a, b) => a + b * b, 0) / dhMeters.length);
  const bias_dh_m = mean(dhMeters);
  const p95_abs_dh_m = ntile(sort(absDh), 0.95);

  stats.push({
    station: station.source.id,
    scheme,
    type: station.type,
    start_utc: start.toISOString(),
    end_utc: end.toISOString(),
    events_chs,
    events_model,
    matched,
    missed,
    extra,
    med_abs_dt_min,
    p95_abs_dt_min,
    mean_dt_min,
    mae_dh_m,
    mean_dh_m,
    rmse_dh_m,
    bias_dh_m,
    p95_abs_dh_m,
  });
  process.stdout.write(".");
}

console.log(
  `\nSkipped: ${skipped.noChsStation} without a CHS station, ` +
    `${skipped.noLatDatum} without a LAT datum, ${skipped.noPredictions} without predictions`,
);

// Write stats to file for later analysis
const summary = createWriteStream(join(__dirname, "chs.csv"));
summary.write(
  "station,scheme,type,start_utc,end_utc,events_chs,events_model,matched,missed,extra,med_abs_dt_min,p95_abs_dt_min,mean_dt_min,mae_dh_m,mean_dh_m,rmse_dh_m,bias_dh_m,p95_abs_dh_m\n",
);

stats.forEach((s) => {
  summary.write(
    [
      s.station,
      s.scheme,
      s.type,
      s.start_utc,
      s.end_utc,
      s.events_chs,
      s.events_model,
      s.matched,
      s.missed,
      s.extra,
      s.med_abs_dt_min.toFixed(2),
      s.p95_abs_dt_min.toFixed(2),
      s.mean_dt_min.toFixed(2),
      s.mae_dh_m.toFixed(4),
      s.mean_dh_m.toFixed(4),
      s.rmse_dh_m.toFixed(4),
      s.bias_dh_m.toFixed(4),
      s.p95_abs_dh_m.toFixed(4),
    ].join(",") + "\n",
  );
});
summary.end();

// Baseline expectations based on current performance. The goal should be to
// move these toward zero over time. TICON constituents are independently
// derived, so residuals run higher than the NOAA benchmark (where the model
// ingests NOAA's own constituents).
const maeValues = sort(stats.map((s) => s.mae_dh_m));
const p50MAE = ntile(maeValues, 0.5);
const p90MAE = ntile(maeValues, 0.9);
const p95MAE = ntile(maeValues, 0.95);

const medAbsDtValues = sort(stats.map((s) => s.med_abs_dt_min));
const p95MedAbsDt = ntile(medAbsDtValues, 0.95);

console.log(`\n${scheme}:`, { count: stats.length, p50MAE, p90MAE, p95MAE, p95MedAbsDt });

// Baseline expectations
expect(p50MAE, "MAE p50").toBeLessThan(0.1); // 10 cm
expect(p90MAE, "MAE p90").toBeLessThan(0.2); // 20 cm
expect(p95MAE, "MAE p95").toBeLessThan(0.35); // 35 cm
expect(p95MedAbsDt, "Median |dt| p95 across stations").toBeLessThanOrEqual(40);

async function fetchCHS(path: string, cacheKey: string) {
  const filePath = `./.test-cache/chs-${cacheKey}.json`;

  try {
    return await readFile(filePath, "utf-8").then((data) => JSON.parse(data));
  } catch {
    const res = await fetch(`${CHS_API}/${path}`);
    const data = await res.json();
    await writeFile(filePath, JSON.stringify(data));
    return data;
  }
}

function sort(data: number[]) {
  return data.sort((a, b) => a - b);
}

function ntile(data: number[], percent: number) {
  return data[Math.floor(data.length * percent)] ?? NaN;
}

function mean(data: number[]) {
  return data.reduce((a, b) => a + b, 0) / data.length;
}
