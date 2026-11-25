import { d2r, r2d } from "../astronomy/constants.js";
import { withoutPerigee } from "./perigee.js";
import type { Fundamentals } from "./types.js";

const fundamentals: Fundamentals = {
  Mm: (a) => corrMm(d2r * a.N.value, d2r * a.p.value),
  Mf: (a) => corrMf(d2r * a.N.value),
  O1: (a) => corrO1(d2r * a.N.value),
  K1: (a) => corrK1(d2r * a.N.value),
  J1: (a) => corrJ1(d2r * a.N.value),
  M1B: (a) => corrM1B(d2r * a.N.value, d2r * a.p.value),
  // Annex A's M1 formula is for an argument without p (1 555 556), so u takes off the p the argument holds.
  M1C: (a, turns, epoch = a) =>
    withoutPerigee(corrM1(d2r * a.N.value, d2r * a.p.value), epoch, turns),
  M1: (a, turns, epoch = a) =>
    withoutPerigee(corrM1(d2r * a.N.value, d2r * a.p.value), epoch, turns),
  M1A: (a) => corrM1A(d2r * a.N.value, d2r * a.p.value),
  M2: (a) => corrM2(d2r * a.N.value),
  K2: (a) => corrK2(d2r * a.N.value),
  M3: (a) => corrM3(d2r * a.N.value),
  L2: (a) => corrL2(d2r * a.N.value, d2r * a.p.value),
  gamma2: (a) => corrGamma2(d2r * a.N.value, d2r * a.p.value),
  alpha2: (a) => corrAlpha2(d2r * a.p.value, d2r * a.pp.value),
  delta2: (a) => corrDelta2(d2r * a.N.value),
  xi2: (a) => corrXiEta2(d2r * a.N.value),
  eta2: (a) => corrXiEta2(d2r * a.N.value),
};

export default fundamentals;

// ─── Fundamental constituent formulas (IHO TWCWG Annex A) ────────────────────

function corrMm(N: number, p: number) {
  return {
    f: 1 - 0.1311 * Math.cos(N) + 0.0538 * Math.cos(2 * p) + 0.0205 * Math.cos(2 * p - N),
    u: 0,
  };
}

function corrMf(N: number) {
  return {
    f: 1.084 + 0.415 * Math.cos(N) + 0.039 * Math.cos(2 * N),
    u: -23.7 * Math.sin(N) + 2.7 * Math.sin(2 * N) - 0.4 * Math.sin(3 * N),
  };
}

function corrO1(N: number) {
  return {
    f: 1.0176 + 0.1871 * Math.cos(N) - 0.0147 * Math.cos(2 * N),
    u: 10.8 * Math.sin(N) - 1.34 * Math.sin(2 * N) + 0.19 * Math.sin(3 * N),
  };
}

function corrK1(N: number) {
  return {
    f: 1.006 + 0.115 * Math.cos(N) - 0.0088 * Math.cos(2 * N) + 0.0006 * Math.cos(3 * N),
    u: -8.86 * Math.sin(N) + 0.68 * Math.sin(2 * N) - 0.07 * Math.sin(3 * N),
  };
}

function corrJ1(N: number) {
  return {
    f: 1.1029 + 0.1676 * Math.cos(N) - 0.017 * Math.cos(2 * N) + 0.0016 * Math.cos(3 * N),
    u: -12.94 * Math.sin(N) + 1.34 * Math.sin(2 * N) - 0.19 * Math.sin(3 * N),
  };
}

function corrM2(N: number) {
  return {
    f: 1.0007 - 0.0373 * Math.cos(N) + 0.0002 * Math.cos(2 * N),
    u: -2.14 * Math.sin(N),
  };
}

function corrK2(N: number) {
  return {
    f: 1.0246 + 0.2863 * Math.cos(N) + 0.0083 * Math.cos(2 * N) - 0.0015 * Math.cos(3 * N),
    u: -17.74 * Math.sin(N) + 0.68 * Math.sin(2 * N) - 0.04 * Math.sin(3 * N),
  };
}

function corrM3(N: number) {
  const m2 = corrM2(N);
  return {
    f: Math.pow(Math.sqrt(m2.f), 3),
    u: -3.21 * Math.sin(N),
  };
}

// ─── Special constituents (f·sinU / f·cosU form) ─────────────────────────────

function corrM1B(N: number, p: number) {
  const fsinU = 2.783 * Math.sin(2 * p) + 0.558 * Math.sin(2 * p - N) + 0.184 * Math.sin(N);
  const fcosU = 1 + 2.783 * Math.cos(2 * p) + 0.558 * Math.cos(2 * p - N) + 0.184 * Math.cos(N);
  return fromSinCos(fsinU, fcosU);
}

function corrM1(N: number, p: number) {
  const fsinU = Math.sin(p) + 0.2 * Math.sin(p - N);
  const fcosU = 2 * (Math.cos(p) + 0.2 * Math.cos(p - N));
  return fromSinCos(fsinU, fcosU);
}

function corrM1A(N: number, p: number) {
  const fsinU = -0.3593 * Math.sin(2 * p) - 0.2 * Math.sin(N) - 0.066 * Math.sin(2 * p - N);
  const fcosU = 1 + 0.3593 * Math.cos(2 * p) + 0.2 * Math.cos(N) + 0.066 * Math.cos(2 * p - N);
  return fromSinCos(fsinU, fcosU);
}

function corrGamma2(N: number, p: number) {
  const fsinU = 0.147 * Math.sin(2 * (N - p));
  const fcosU = 1 + 0.147 * Math.cos(2 * (N - p));
  return fromSinCos(fsinU, fcosU);
}

function corrAlpha2(p: number, pp: number) {
  const fsinU = -0.0446 * Math.sin(p - pp);
  const fcosU = 1 - 0.0446 * Math.cos(p - pp);
  return fromSinCos(fsinU, fcosU);
}

function corrDelta2(N: number) {
  const fsinU = 0.477 * Math.sin(N);
  const fcosU = 1 - 0.477 * Math.cos(N);
  return fromSinCos(fsinU, fcosU);
}

function corrXiEta2(N: number) {
  const fsinU = -0.439 * Math.sin(N);
  const fcosU = 1 + 0.439 * Math.cos(N);
  return fromSinCos(fsinU, fcosU);
}

function corrL2(N: number, p: number) {
  const fsinU =
    -0.2505 * Math.sin(2 * p) -
    0.1102 * Math.sin(2 * p - N) -
    0.0156 * Math.sin(2 * p - 2 * N) -
    0.037 * Math.sin(N);
  const fcosU =
    1 -
    0.2505 * Math.cos(2 * p) -
    0.1102 * Math.cos(2 * p - N) -
    0.0156 * Math.cos(2 * p - 2 * N) -
    0.037 * Math.cos(N);
  return fromSinCos(fsinU, fcosU);
}

/**
 * Compute f and u from f·sinU / f·cosU form.
 */
function fromSinCos(fsinU: number, fcosU: number) {
  const f = Math.sqrt(fsinU * fsinU + fcosU * fcosU);
  const u = r2d * Math.atan2(fsinU, fcosU);
  return { f, u };
}
