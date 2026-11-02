// Subordinate-station validation fixture: the reference's harmonic constants plus
// the subordinate's NOAA offsets, compared to NOAA's own hi/lo for the subordinate.
// Two stations cover both height-offset forms: Nurse Channel (ratio, Bahamas,
// 600 km from its reference) and Kamalo Harbor (fixed, Hawaii).
import { loadStations } from '@slackwater/database';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeJSON } from './write.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..');
// The database stores values as 32-bit floats; round off the float32 noise so
// the fixture holds the source data's precision (NOAA publishes 1-3 decimals).
const round = (value) => Number(value.toPrecision(6));
// Fixed key order, independent of the database's serialization order.
const subOffsets = ({ reference, height, time }) => ({
  reference,
  height: { type: height.type, high: round(height.high), low: round(height.low) },
  time: { high: time.high, low: time.low },
});
const BEGIN = '20260715', END = '20260717';
const startISO = '2026-07-15T00:00:00Z', endISO = '2026-07-17T23:59:00Z';

const noaa = async (id) => {
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${BEGIN}&end_date=${END}`
    + `&station=${id}&product=predictions&datum=MLLW&interval=hilo&units=metric&time_zone=gmt&format=json`;
  const { predictions } = await (await fetch(url)).json();
  return predictions.map((p) => ({ time: p.t.replace(' ', 'T') + ':00Z', height: parseFloat(p.v), kind: p.type === 'H' ? 'high' : 'low' }));
};

const { accepted: stations } = await loadStations();
const cases = [];
for (const id of ['noaa/TEC4635', 'noaa/1613077']) {
  const sub = stations.find((s) => s.id === id);
  const ref = stations.find((s) => s.id === sub.offsets.reference);
  cases.push({
    station: sub.id,
    name: sub.name,
    reference: ref.id,
    offset: round(ref.datums.MSL - ref.datums.MLLW),
    constituents: ref.harmonic_constituents.map((c) => ({ name: c.name, amplitude: round(c.amplitude), phase: round(c.phase) })),
    offsets: subOffsets(sub.offsets),
    official: await noaa(id.replace('noaa/', '')),
  });
  console.log(sub.name, '->', ref.name, cases.at(-1).official.length, 'official extremes');
}
writeJSON(join(FIX, 'realworld-subordinates.json'), {
  note: 'Subordinate tide stations. Constituents are the REFERENCE station\'s (from @slackwater/database, NOAA '
    + 'source); offsets are the subordinate\'s NOAA time/height corrections; official hi/lo is NOAA CO-OPS for '
    + 'the SUBORDINATE (datum MLLW, GMT). offset = reference MSL-MLLW.',
  start: startISO, end: endISO, cases,
});
