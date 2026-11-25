import { d2r, r2d } from "../astronomy/constants.js";
import type { AstroData } from "../astronomy/index.js";
import { withoutPerigee } from "./perigee.js";
import type { Fundamentals } from "./types.js";

const fundamentals: Fundamentals = {
  Mm: (a) => ({ f: fMm(a), u: 0 }),
  Mf: (a) => ({ f: fMf(a), u: uMf(a) }),
  O1: (a) => ({ f: fO1(a), u: uO1(a) }),
  K1: (a) => ({ f: fK1(a), u: uK1(a) }),
  J1: (a) => ({ f: fJ1(a), u: uJ1(a) }),
  OO1: (a) => ({ f: fOO1(a), u: uOO1(a) }),
  M2: (a) => ({ f: fM2(a), u: uM2(a) }),
  K2: (a) => ({ f: fK2(a), u: uK2(a) }),
  L2: (a) => ({ f: fL2(a), u: uL2(a) }),
  M1: (a, turns, epoch = a) => withoutPerigee({ f: fM1(a), u: uM1(a) }, epoch, turns),
  M3: (a) => ({ f: fModd(a, 3), u: uModd(a, 3) }),
};

export default fundamentals;

// ─── Schureman f (amplitude) functions ────────────────────────────────────────

// Schureman equations 73, 65
function fMm(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean =
    (2 / 3.0 - Math.pow(Math.sin(omega), 2)) * (1 - (3 / 2.0) * Math.pow(Math.sin(i), 2));
  return (2 / 3.0 - Math.pow(Math.sin(I), 2)) / mean;
}

// Schureman equations 74, 66
function fMf(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean = Math.pow(Math.sin(omega), 2) * Math.pow(Math.cos(0.5 * i), 4);
  return Math.pow(Math.sin(I), 2) / mean;
}

// Schureman equations 75, 67
function fO1(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean =
    Math.sin(omega) * Math.pow(Math.cos(0.5 * omega), 2) * Math.pow(Math.cos(0.5 * i), 4);
  return (Math.sin(I) * Math.pow(Math.cos(0.5 * I), 2)) / mean;
}

// Schureman equations 76, 68
function fJ1(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean = Math.sin(2 * omega) * (1 - (3 / 2.0) * Math.pow(Math.sin(i), 2));
  return Math.sin(2 * I) / mean;
}

// Schureman equations 77, 69
function fOO1(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean =
    Math.sin(omega) * Math.pow(Math.sin(0.5 * omega), 2) * Math.pow(Math.cos(0.5 * i), 4);
  return (Math.sin(I) * Math.pow(Math.sin(0.5 * I), 2)) / mean;
}

// Schureman equations 78, 70
function fM2(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const mean = Math.pow(Math.cos(0.5 * omega), 4) * Math.pow(Math.cos(0.5 * i), 4);
  return Math.pow(Math.cos(0.5 * I), 4) / mean;
}

// Schureman equations 227, 226, 68
function fK1(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const nu = d2r * a.nu.value;
  const sin2IcosnuMean = Math.sin(2 * omega) * (1 - (3 / 2.0) * Math.pow(Math.sin(i), 2));
  const mean = 0.5023 * sin2IcosnuMean + 0.1681;
  return (
    Math.pow(
      0.2523 * Math.pow(Math.sin(2 * I), 2) + 0.1689 * Math.sin(2 * I) * Math.cos(nu) + 0.0283,
      0.5,
    ) / mean
  );
}

// Schureman equations 215, 213, 204
function fL2(a: AstroData): number {
  const P = d2r * a.P.value;
  const I = d2r * a.I.value;
  const rAInv = Math.pow(
    1 - 12 * Math.pow(Math.tan(0.5 * I), 2) * Math.cos(2 * P) + 36 * Math.pow(Math.tan(0.5 * I), 4),
    0.5,
  );
  return fM2(a) * rAInv;
}

// Schureman equations 235, 234, 71
function fK2(a: AstroData): number {
  const omega = d2r * a.omega.value;
  const i = d2r * a.i.value;
  const I = d2r * a.I.value;
  const nu = d2r * a.nu.value;
  const sinsqIcos2nuMean = Math.sin(omega) ** 2 * (1 - (3 / 2.0) * Math.sin(i) ** 2);
  const mean = 0.5023 * sinsqIcos2nuMean + 0.0365;
  return (
    Math.pow(
      0.2523 * Math.pow(Math.sin(I), 4) +
        0.0367 * Math.pow(Math.sin(I), 2) * Math.cos(2 * nu) +
        0.0013,
      0.5,
    ) / mean
  );
}

// Schureman equations 206, 207, 195
function fM1(a: AstroData): number {
  const P = d2r * a.P.value;
  const I = d2r * a.I.value;
  const qAInv = Math.pow(
    0.25 +
      1.5 * Math.cos(I) * Math.cos(2 * P) * Math.pow(Math.cos(0.5 * I), -2) +
      2.25 * Math.pow(Math.cos(I), 2) * Math.pow(Math.cos(0.5 * I), -4),
    0.5,
  );
  return fO1(a) * qAInv;
}

// Schureman equation 149
function fModd(a: AstroData, n: number): number {
  return Math.pow(fM2(a), n / 2.0);
}

// ─── Schureman u (phase) functions ────────────────────────────────────────────

function uMf(a: AstroData): number {
  return -2.0 * a.xi.value;
}

function uO1(a: AstroData): number {
  return 2.0 * a.xi.value - a.nu.value;
}

function uJ1(a: AstroData): number {
  return -a.nu.value;
}

function uOO1(a: AstroData): number {
  return -2.0 * a.xi.value - a.nu.value;
}

function uM2(a: AstroData): number {
  return 2.0 * a.xi.value - 2.0 * a.nu.value;
}

function uK1(a: AstroData): number {
  return -a.nup.value;
}

// Schureman 214
function uL2(a: AstroData): number {
  const I = d2r * a.I.value;
  const P = d2r * a.P.value;
  const R =
    r2d *
    Math.atan(Math.sin(2 * P) / ((1 / 6.0) * Math.pow(Math.tan(0.5 * I), -2) - Math.cos(2 * P)));
  return 2.0 * a.xi.value - 2.0 * a.nu.value - R;
}

function uK2(a: AstroData): number {
  return -2.0 * a.nupp.value;
}

// Schureman 202, for the argument T − s + h − 90°, without p.
function uM1(a: AstroData): number {
  const I = d2r * a.I.value;
  const P = d2r * a.P.value;
  const k = (5 * Math.cos(I) - 1) / (7 * Math.cos(I) + 1);
  // atan2 keeps Q in P's half-turn, so Q turns with P instead of jumping 180°.
  const Q = r2d * Math.atan2(k * Math.sin(P), Math.cos(P));
  return a.xi.value - a.nu.value + Q;
}

function uModd(a: AstroData, n: number): number {
  return (n / 2.0) * uM2(a);
}
