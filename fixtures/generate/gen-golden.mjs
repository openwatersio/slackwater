// Generate golden-vector fixtures from the Slackwater JS reference (@slackwater/engine).
// Slackwater is the oracle: Slackwater (Swift) must match these to the tolerances in the plan.
// Usage: node fixtures/generate/gen-golden.mjs
import { astro, constituents, createTidePredictor } from '@slackwater/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeJSON } from './write.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = (name, obj) => writeJSON(join(FIX, name), obj);
const iso = (d) => new Date(d).toISOString();
const unwrap = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, (v && typeof v === 'object' && 'value' in v) ? v.value : v]));

// Spread of UTC timestamps across the 18.6-year nodal cycle to exercise corrections.
const TIMES = [
  '2000-01-01T00:00:00Z', '2010-06-15T12:00:00Z', '2020-03-21T06:30:00Z',
  '2026-07-12T00:00:00Z', '2026-07-12T18:45:00Z', '2031-11-02T09:15:00Z',
  '2035-09-23T00:00:00Z', '2040-12-31T23:00:00Z',
];

// ---- Task 1: astronomy ----
write('astronomy.json', {
  note: 'Slackwater astro(date) unwrapped to plain degrees; Slackwater must match within 1e-6.',
  times: TIMES,
  values: TIMES.map((t) => ({ time: iso(t), astro: unwrap(astro(new Date(t))) })),
});

// ---- Task 2: node corrections (IHO — the default scheme prediction uses) ----
const IHO_NAMES = ['Mm', 'Mf', 'O1', 'K1', 'J1', 'M1', 'M1A', 'M1B', 'M2', 'K2', 'M3', 'L2', 'gamma2', 'alpha2', 'delta2', 'xi2', 'eta2'];
const ncTimes = ['2020-03-21T06:30:00Z', '2026-07-12T00:00:00Z', '2035-09-23T00:00:00Z'];
write('node-corrections.json', {
  note: 'Slackwater IHO fundamentals via constituents[name].correction(astro). f dimensionless, u degrees.',
  entries: ncTimes.map((t) => ({
    time: iso(t),
    corrections: Object.fromEntries(IHO_NAMES.map((n) => {
      const c = constituents[n].correction(astro(new Date(t)));
      return [n, { f: c.f, u: c.u }];
    })),
  })),
});

// ---- Task 3: constituent V0 + resolved node corrections ----
const SAMPLE_CONSTITUENTS = [
  'M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1', 'J1', 'M1', 'Mm', 'Mf', 'Sa', 'Ssa',
  'M4', 'M6', 'MS4', 'MN4', 'MK3', '2MK3', 'MK4', '2N2', 'nu2', 'mu2', 'L2', 'lambda2',
  'T2', 'R2', 'OO1', 'rho1', 'S4', 'S6', 'M3', '2MS6', 'MSf', 'MSm', 'SO3', 'MO3', 'SK3',
];
const c3Times = ['2020-03-21T06:30:00Z', '2026-07-12T00:00:00Z'];
write('constituents.json', {
  note: 'Slackwater c.value(astro) (V0, degrees) and c.correction(astro) (f,u) for sample constituents.',
  entries: c3Times.map((t) => {
    const a = astro(new Date(t));
    return {
      time: iso(t),
      constituents: Object.fromEntries(SAMPLE_CONSTITUENTS.filter((n) => constituents[n]).map((n) => {
        const c = constituents[n];
        const corr = c.correction(a);
        return [n, { v0: c.value(a), f: corr.f, u: corr.u }];
      })),
    };
  }),
});

// ---- Task 4: timeline prediction ----
// Representative mixed-tide constituent set (Victoria-like magnitudes). The point of
// this fixture is engine equivalence vs Slackwater; real CHS constants are validated in Task 6.
const PREDICT_SET = [
  { name: 'M2', amplitude: 0.96, phase: 128 }, { name: 'S2', amplitude: 0.26, phase: 155 },
  { name: 'N2', amplitude: 0.21, phase: 108 }, { name: 'K2', amplitude: 0.08, phase: 150 },
  { name: 'K1', amplitude: 0.84, phase: 268 }, { name: 'O1', amplitude: 0.50, phase: 250 },
  { name: 'P1', amplitude: 0.26, phase: 264 }, { name: 'Q1', amplitude: 0.09, phase: 236 },
  { name: 'M4', amplitude: 0.02, phase: 40 }, { name: 'MS4', amplitude: 0.01, phase: 70 },
  { name: 'Mf', amplitude: 0.03, phase: 300 }, { name: 'Mm', amplitude: 0.02, phase: 20 },
];
const predStart = new Date('2026-07-12T00:00:00Z');
const predEnd = new Date(predStart.getTime() + 48 * 3600e3);
const predictor = createTidePredictor(PREDICT_SET);
const timeline = predictor.getTimelinePrediction({ start: predStart, end: predEnd });
write('prediction-victoria.json', {
  note: 'Slackwater getTimelinePrediction for a representative mixed-tide set. 48h @ 600s. Heights in metres.',
  constituents: PREDICT_SET,
  start: iso(predStart), end: iso(predEnd), step: 600,
  points: timeline.map((p) => ({ time: iso(p.time), height: p.level })),
});

// ---- Task 5: extremes ----
const extremes = predictor.getExtremesPrediction({ start: predStart, end: predEnd });
write('extremes-victoria.json', {
  note: 'Slackwater getExtremesPrediction for the same set/window. Heights metres, times ISO.',
  start: iso(predStart), end: iso(predEnd),
  extremes: extremes.map((e) => ({ time: iso(e.time), height: e.level, kind: e.high ? 'high' : 'low' })),
});

// ---- Task 5b: a turn on UTC midnight ----
// Cambridge, MD (noaa/8571892) puts the low of 26 July 2026 within a second of 00:00 UTC, where
// each day's search hands over to the next day's parameters. Its constants are a copy, so a
// database update can't move the low off midnight.
const cambridge = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cambridge-md.json'), 'utf8'));
const midnightSet = cambridge.constituents;
const midnightStart = new Date('2026-07-25T12:00:00Z');
const midnightEnd = new Date('2026-07-27T12:00:00Z');
write('extremes-midnight.json', {
  note: 'Slackwater getExtremesPrediction for noaa/8571892, whose low of 2026-07-26 falls on 00:00 UTC. Heights metres, times ISO.',
  station: cambridge.station,
  constituents: midnightSet,
  start: iso(midnightStart), end: iso(midnightEnd),
  extremes: createTidePredictor(midnightSet).getExtremesPrediction({ start: midnightStart, end: midnightEnd })
    .map((e) => ({ time: iso(e.time), height: e.level, kind: e.high ? 'high' : 'low' })),
});

console.log('done');
