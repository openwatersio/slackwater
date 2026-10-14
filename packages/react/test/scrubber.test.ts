import { describe, expect, test } from "vitest";
import {
  EDGE_MS,
  MAGNET_MS,
  UNIT_MS,
  adjacentTarget,
  awayFromEdges,
  dayRowHit,
  magnetTarget,
  reachable,
  rides,
  thinLabels,
} from "../src/utils/scrubber.js";

const H = 3_600_000;
const M = 60_000;

test("one unit is 200 seconds and the magnet reaches 15 minutes", () => {
  expect(UNIT_MS).toBe(200_000);
  expect(MAGNET_MS).toBe(15 * M);
});

describe("magnetTarget", () => {
  const targets = [H, 2 * H];
  test("captures strictly within 4.5 units", () => {
    expect(magnetTarget(targets, H + 10 * M)).toBe(H);
    expect(magnetTarget(targets, H + 15 * M)).toBeUndefined();
    expect(magnetTarget(targets, H - 40 * M)).toBeUndefined();
  });
  test("assigns the exact target even within half a unit", () => {
    expect(magnetTarget(targets, H + 50_000)).toBe(H);
  });
  test("prefers the nearer target, and the earlier on a tie", () => {
    expect(magnetTarget([H, H + 20 * M], H + 11 * M)).toBe(H + 20 * M);
    expect(magnetTarget([H, H + 20 * M], H + 10 * M)).toBe(H);
  });
});

test("adjacentTarget ignores targets within a second", () => {
  const targets = [H, 2 * H, 3 * H];
  expect(adjacentTarget(targets, 2 * H + 500, true)).toBe(3 * H);
  expect(adjacentTarget(targets, 2 * H - 500, false)).toBe(H);
  expect(adjacentTarget(targets, 3 * H, true)).toBeUndefined();
  expect(adjacentTarget(targets, H, false)).toBeUndefined();
});

describe("reachable", () => {
  test("clamps to the centers the scroll range can reach", () => {
    expect(reachable(H, 0, 100 * H, 20 * H)).toBe(10 * H);
    expect(reachable(99 * H, 0, 100 * H, 20 * H)).toBe(90 * H);
    expect(reachable(50 * H, 0, 100 * H, 20 * H)).toBe(50 * H);
  });
  test("a viewport wider than the window can only sit at its start", () => {
    expect(reachable(5 * H, 0, 10 * H, 30 * H)).toBe(15 * H);
  });
});

test("rides: animate up to seven days unless motion is reduced or the move is under half a unit", () => {
  expect(rides(0, 7 * 24 * H, false)).toBe(true);
  expect(rides(0, 7 * 24 * H + 1, false)).toBe(false);
  expect(rides(0, H, true)).toBe(false);
  expect(rides(0, UNIT_MS / 2 - 1, false)).toBe(false);
});

test("awayFromEdges keeps marks 1.5 hours or more from both edges", () => {
  const items = [0, EDGE_MS - 1, EDGE_MS, 10 * H - EDGE_MS, 10 * H - EDGE_MS + 1].map((time) => ({
    time,
  }));
  expect(awayFromEdges(items, 0, 10 * H).map((i) => i.time)).toEqual([EDGE_MS, 10 * H - EDGE_MS]);
});

test("thinLabels keeps the earlier of labels under 64 units apart", () => {
  const gap = 64 * UNIT_MS;
  const items = [0, gap - 1, gap, 2 * gap - 1].map((time) => ({ time }));
  expect(thinLabels(items).map((i) => i.time)).toEqual([0, gap]);
});

test("dayRowHit: nearest anchor, a date winning a tie", () => {
  expect(dayRowHit([H], [3 * H], 1.5 * H)).toEqual({ time: H, sun: true });
  expect(dayRowHit([H], [3 * H], 2 * H)).toEqual({ time: 3 * H, sun: false });
  expect(dayRowHit([], [], H)).toBeUndefined();
});
