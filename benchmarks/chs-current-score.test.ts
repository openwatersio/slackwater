import { describe, expect, test } from "vitest";
import {
  hasSlackOrExtremum,
  pairSlacks,
  parseEvents,
  rounded,
  scoreWeek,
  summarize,
  type ScoreEvent,
  type WeekScore,
} from "./chs-current-score.ts";

const start = Date.UTC(2026, 10, 5);
const end = start + 7 * 86_400_000;
const at = (minutes: number) => start + minutes * 60_000;
const slack = (minutes: number): ScoreEvent => ({ time: at(minutes), kind: "slack", speed: 0 });
const flood = (minutes: number, speed: number): ScoreEvent => ({
  time: at(minutes),
  kind: "maxFlood",
  speed,
});
const ebb = (minutes: number, speed: number): ScoreEvent => ({
  time: at(minutes),
  kind: "maxEbb",
  speed,
});
const weak = (minutes: number): ScoreEvent => ({ time: at(minutes), kind: "weak", speed: 0 });
const week = (observed: ScoreEvent[], predicted: ScoreEvent[], velocityAt = () => 1) =>
  scoreWeek({ start, end, observed, predicted, velocityAt });

describe("pairSlacks", () => {
  test("prefers the closer pair when only one can be made", () => {
    expect(pairSlacks([at(60), at(160)], [at(150), at(400)])).toEqual(new Map([[1, 0]]));
  });

  test("keeps pairs in time order at a double slack", () => {
    expect(pairSlacks([at(100), at(130)], [at(125), at(155)])).toEqual(
      new Map([
        [0, 0],
        [1, 1],
      ]),
    );
  });

  test("never pairs slacks farther apart than the window", () => {
    expect(pairSlacks([at(0)], [at(181)])).toEqual(new Map());
  });
});

describe("scoreWeek", () => {
  test("pairs each CHS slack with the predicted slack beside it", () => {
    const score = week([slack(60), slack(432), slack(804)], [slack(65), slack(430), slack(810)]);
    expect(score.slack_errors).toEqual([5, 2, 6]);
    expect(score.invented).toBe(0);
  });

  test("lets one predicted slack pair with one CHS slack only", () => {
    expect(week([slack(100), slack(160)], [slack(130)]).slack_errors).toEqual([30, null]);
  });

  test("scores a late double slack in order", () => {
    expect(week([slack(100), slack(130)], [slack(125), slack(155)]).slack_errors).toEqual([25, 25]);
  });

  test("pairs a late model's slacks in order rather than inventing one", () => {
    const score = week([slack(1000), slack(1240)], [slack(1130), slack(1380)]);
    expect(score.slack_errors).toEqual([130, 140]);
    expect(score.invented).toBe(0);
  });

  test("counts a predicted slack no CHS slack pairs with as invented", () => {
    const score = week([slack(60)], [slack(62), slack(400)]);
    expect(score.slack_errors).toEqual([2]);
    expect(score.invented).toBe(1);
  });

  test("pairs across the week's edge without missing or inventing a slack", () => {
    const score = week([slack(-10)], [slack(5)]);
    expect(score.slack_errors).toEqual([]);
    expect(score.invented).toBe(0);
  });

  test("lets a CHS slack before the week pair with its own neighbour, not one inside the week", () => {
    const score = week([slack(-170), slack(170)], [slack(-200), slack(5), slack(175)]);
    expect(score.slack_errors).toEqual([5]);
    expect(score.invented).toBe(1);
  });

  test("lets a CHS slack after the week pair with its own neighbour, not one inside the week", () => {
    const w = 7 * 1440;
    const score = week(
      [slack(w - 170), slack(w + 170)],
      [slack(w - 175), slack(w - 5), slack(w + 200)],
    );
    expect(score.slack_errors).toEqual([5]);
    expect(score.invented).toBe(1);
  });

  test("ignores predicted slacks in the padding", () => {
    expect(week([], [slack(7 * 1440 + 60)]).invented).toBe(0);
  });

  test("misses every CHS slack when the model never reverses", () => {
    const score = week([slack(60), slack(432)], [flood(200, 1.5)]);
    expect(score.slack_errors).toEqual([null, null]);
    expect(score.invented).toBe(0);
  });

  test("scores a week with peak flows but no slack", () => {
    const score = week([flood(100, 1.2)], [slack(50), slack(300), flood(110, 1)]);
    expect(score.slack_errors).toEqual([]);
    expect(score.invented).toBe(2);
    expect(score.extremum_errors).toEqual([10]);
    expect(score.speed_errors[0]).toBeCloseTo(0.2, 12);
  });

  test("matches extrema by kind", () => {
    const score = week([flood(100, 2)], [ebb(101, -2), flood(130, 1.8)]);
    expect(score.extremum_errors).toEqual([30]);
    expect(score.speed_errors[0]).toBeCloseTo(0.2, 12);
  });

  test("drops an extremum with no same-kind prediction within the window", () => {
    const score = week([flood(100, 2)], [flood(400, 2)]);
    expect(score.extrema).toBe(1);
    expect(score.extremum_errors).toEqual([]);
  });

  test("skips timing and speed for weak extrema but still checks their sign", () => {
    const score = week([ebb(200, -0.4)], [ebb(205, -0.5)], () => 0.2);
    expect(score).toMatchObject({
      extrema: 1,
      wrong_sign: 1,
      extremum_errors: [],
      speed_errors: [],
    });
  });

  test("does not count a predicted slack pair around a CHS weak-and-variable event as invented", () => {
    // Active Pass at neaps: CHS publishes ebb, weak and variable, ebb where the model reverses for an hour.
    const score = week(
      [slack(526), ebb(698, -1.6), weak(1000), ebb(1361, -2.9), slack(1575)],
      [
        slack(530),
        ebb(700, -1.5),
        slack(940),
        flood(1003, 0.2),
        slack(1060),
        ebb(1358, -2.8),
        slack(1572),
      ],
      () => -1,
    );
    expect(score).toMatchObject({ slack_errors: [4, 3], invented: 0, extrema: 2, wrong_sign: 0 });
  });

  test("still counts a predicted slack pair around a strong predicted reversal as invented", () => {
    expect(week([weak(1000)], [slack(940), flood(1003, 2.5), slack(1060)]).invented).toBe(2);
    expect(week([weak(1000)], [slack(940), flood(1003, 0.75), slack(1060)]).invented).toBe(2);
    expect(
      week([weak(1000)], [slack(940), flood(970, 0.2), flood(1030, 2.5), slack(1060)]).invented,
    ).toBe(2);
  });

  test("still counts a predicted slack pair with no predicted extremum between them as invented", () => {
    expect(week([weak(1000)], [slack(940), slack(1060)]).invented).toBe(2);
  });

  test("excuses a weak predicted slack pair an event lies outside when both slacks are within the window", () => {
    expect(week([weak(900)], [slack(940), flood(1000, 0.2), slack(1060)]).invented).toBe(0);
  });

  test("excuses a weak predicted slack pair that lies wholly before the event", () => {
    // Johnstone Strait Central: CHS stamps the weak event after the model's lull has ended.
    expect(week([weak(1000)], [slack(900), flood(930, 0.01), slack(980)]).invented).toBe(0);
    // The model's next slack, hours away, is the only one left to count.
    expect(
      week([weak(1000)], [slack(900), flood(930, 0.01), slack(980), ebb(1150, -2), slack(1300)])
        .invented,
    ).toBe(1);
  });

  test("excuses a weak predicted slack pair that lies wholly after the event", () => {
    expect(week([weak(1000)], [slack(1001), flood(1015, 0.01), slack(1031)]).invented).toBe(0);
  });

  test("excuses a weak predicted slack pair when no predicted slack follows the event", () => {
    expect(week([weak(1100)], [slack(940), flood(990, 0.2), slack(1040)]).invented).toBe(0);
  });

  test("excuses one of two qualifying weak predicted slack pairs, never both", () => {
    // The nearer pair follows the event, then precedes it. The other pair's two slacks stay
    // invented; the tests below pin which pair is the nearer one.
    expect(
      week(
        [weak(1000)],
        [slack(850), flood(880, 0.2), slack(910), slack(1030), flood(1050, 0.2), slack(1070)],
      ).invented,
    ).toBe(2);
    expect(
      week(
        [weak(1000)],
        [slack(930), flood(950, 0.2), slack(970), slack(1090), flood(1120, 0.2), slack(1150)],
      ).invented,
    ).toBe(2);
  });

  test("excuses the nearer of two weak predicted slack pairs, not the earlier, at the week's start", () => {
    // The pair before the week is 130 minutes from the event and the pair after it 20, so
    // excusing the earlier pair would leave the in-week pair invented.
    expect(
      week(
        [weak(0)],
        [slack(-170), flood(-150, 0.2), slack(-130), slack(20), flood(40, 0.2), slack(60)],
      ).invented,
    ).toBe(0);
  });

  test("excuses the nearest pair for the first of two events, leaving the farther pair invented", () => {
    // The second event is beyond the window of the farther pair, which an earliest-first choice
    // for the first event would have excused.
    expect(
      week(
        [weak(1000), weak(1100)],
        [slack(850), flood(880, 0.2), slack(910), slack(1030), flood(1050, 0.2), slack(1070)],
      ).invented,
    ).toBe(2);
  });

  test("prefers a weak pair around the event to a narrower pair with a nearer centre", () => {
    // The pair around the event is 0 minutes away, the narrower pair 20; only the first is excused.
    expect(
      week(
        [weak(0)],
        [slack(-170), flood(-80, 0.2), slack(10), slack(20), flood(30, 0.2), slack(40)],
      ).invented,
    ).toBe(2);
  });

  test("excuses the earlier of two equally near weak predicted slack pairs", () => {
    // Both pairs are 80 minutes from the event. At the week's start only the later pair is in the
    // week to count, and at its end only the earlier, so each end tells earlier-wins apart from
    // later-wins and from nothing excused.
    expect(
      week(
        [weak(0)],
        [slack(-120), flood(-100, 0.2), slack(-80), slack(80), flood(100, 0.2), slack(120)],
      ).invented,
    ).toBe(2);
    const w = 7 * 1440;
    expect(
      week(
        [weak(w)],
        [
          slack(w - 120),
          flood(w - 100, 0.2),
          slack(w - 80),
          slack(w + 80),
          flood(w + 100, 0.2),
          slack(w + 120),
        ],
      ).invented,
    ).toBe(0);
  });

  test("excuses a weak pair beside the event while the pair around it reverses strongly", () => {
    // The strong pair shares its second slack with the weak pair, so only its first slack stays invented.
    expect(
      week([weak(1000)], [slack(950), flood(1000, 2), slack(1050), ebb(1080, -0.2), slack(1110)])
        .invented,
    ).toBe(1);
  });

  test("excuses nothing when only one unpaired predicted slack lies beside a weak-and-variable event", () => {
    expect(week([weak(1000)], [slack(1060)]).invented).toBe(1);
    expect(week([weak(1000)], [slack(940)]).invented).toBe(1);
    expect(
      week([slack(940), weak(1000)], [slack(940), flood(1000, 0.2), slack(1060)]).invented,
    ).toBe(1);
  });

  test("still counts a predicted slack pair farther than the window from a weak-and-variable event", () => {
    expect(week([weak(1000)], [slack(819), flood(940, 0.2), slack(1060)]).invented).toBe(2);
    expect(week([weak(1000)], [slack(940), flood(1060, 0.2), slack(1181)]).invented).toBe(2);
  });

  test("excuses a predicted slack pair exactly the window from a weak-and-variable event", () => {
    expect(week([weak(1000)], [slack(820), flood(1000, 0.2), slack(1180)]).invented).toBe(0);
  });

  test("excuses a weak predicted slack pair when the event falls at either slack's own time", () => {
    expect(week([weak(1000)], [slack(1000), flood(1050, 0.2), slack(1100)]).invented).toBe(0);
    expect(week([weak(1000)], [slack(900), flood(950, 0.2), slack(1000)]).invented).toBe(0);
  });

  test("lets a weak-and-variable event excuse one pair, and a predicted slack be excused once", () => {
    expect(
      week([weak(1000)], [slack(880), slack(940), flood(1000, 0.2), slack(1060), slack(1120)])
        .invented,
    ).toBe(2);
    expect(
      week(
        [weak(1000), weak(1120)],
        [slack(940), flood(1000, 0.2), slack(1060), ebb(1120, -0.2), slack(1180)],
      ).invented,
    ).toBe(1);
  });

  test("excuses a pair straddling the week's edge from either week", () => {
    const observed = [weak(-10)];
    const predicted = [slack(-70), flood(-10, 0.2), slack(50)];
    expect(week(observed, predicted).invented).toBe(0);
    const before = scoreWeek({
      start: start - 7 * 86_400_000,
      end: start,
      observed,
      predicted,
      velocityAt: () => 1,
    });
    expect(before.invented).toBe(0);
  });

  test("never counts a weak-and-variable event as an extremum or a wrong sign", () => {
    for (const v of [-1, 1]) {
      expect(week([weak(1000)], [], () => v)).toMatchObject({
        extrema: 0,
        wrong_sign: 0,
        extremum_errors: [],
        speed_errors: [],
      });
    }
  });
});

describe("parseEvents", () => {
  test("reads slacks, floods and ebbs, with ebbs negative, in time order", () => {
    const events = parseEvents([
      { eventDate: "2026-11-05T06:00:00Z", qualifier: "EXTREMA_EBB", value: 2.5 },
      { eventDate: "2026-11-05T03:00:00Z", qualifier: "SLACK", value: 0 },
      { eventDate: "2026-11-05T00:00:00Z", qualifier: "EXTREMA_FLOOD", value: 3 },
    ]);
    expect(events).toEqual([
      { time: Date.UTC(2026, 10, 5, 0), kind: "maxFlood", speed: 3 },
      { time: Date.UTC(2026, 10, 5, 3), kind: "slack", speed: 0 },
      { time: Date.UTC(2026, 10, 5, 6), kind: "maxEbb", speed: -2.5 },
    ]);
  });

  test("reads a weak-and-variable row as a weak event at speed 0, with or without a value", () => {
    const events = parseEvents([
      { eventDate: "2026-11-05T06:00:00Z", qualifier: "WEAK_AND_VARIABLE" },
      { eventDate: "2026-11-05T03:00:00Z", qualifier: "OTHER", value: 0 },
      { eventDate: "2026-11-05T00:00:00Z", qualifier: "WEAK_AND_VARIABLE", value: 0 },
    ]);
    expect(events).toEqual([
      { time: Date.UTC(2026, 10, 5, 0), kind: "weak", speed: 0 },
      { time: Date.UTC(2026, 10, 5, 6), kind: "weak", speed: 0 },
    ]);
  });

  test("drops rows with another qualifier", () => {
    expect(
      parseEvents([{ eventDate: "2026-11-05T00:00:00Z", qualifier: "OTHER", value: null }]),
    ).toEqual([]);
    expect(
      parseEvents([{ eventDate: "2026-11-05T00:00:00Z", qualifier: "toString", value: 1 }]),
    ).toEqual([]);
  });

  test("stops on an unreadable date, which would otherwise score as a missed slack", () => {
    expect(() => parseEvents([{ eventDate: "5 Nov 2026", qualifier: "SLACK", value: 0 }])).toThrow(
      /unreadable/,
    );
  });

  test("stops on an extremum with no speed", () => {
    expect(() =>
      parseEvents([{ eventDate: "2026-11-05T00:00:00Z", qualifier: "EXTREMA_FLOOD", value: null }]),
    ).toThrow(/speed/);
  });

  test("stops on a negative extremum speed, since CHS publishes magnitudes", () => {
    for (const qualifier of ["EXTREMA_FLOOD", "EXTREMA_EBB"]) {
      expect(() =>
        parseEvents([{ eventDate: "2026-11-05T00:00:00Z", qualifier, value: -1.2 }]),
      ).toThrow(/negative/);
    }
  });

  test("refuses anything but an array", () => {
    expect(() => parseEvents({})).toThrow(TypeError);
  });
});

describe("hasSlackOrExtremum", () => {
  test("finds nothing to score in weak-and-variable events alone", () => {
    expect(hasSlackOrExtremum([])).toBe(false);
    expect(hasSlackOrExtremum([weak(1000), weak(2500)])).toBe(false);
  });

  test("finds a slack, a flood or an ebb", () => {
    expect(hasSlackOrExtremum([weak(1000), slack(1060)])).toBe(true);
    expect(hasSlackOrExtremum([flood(100, 1.2)])).toBe(true);
    expect(hasSlackOrExtremum([weak(1000), ebb(1361, -2.9)])).toBe(true);
  });
});

describe("summarize", () => {
  const score = (s: Partial<WeekScore>): WeekScore => ({
    slack_errors: [],
    invented: 0,
    extremum_errors: [],
    speed_errors: [],
    extrema: 0,
    wrong_sign: 0,
    ...s,
  });

  test("takes medians and the worst over matched slacks and counts the missed ones", () => {
    expect(summarize(score({ slack_errors: [5, null, 10, 20] }))).toMatchObject({
      slacks: 4,
      missed: 1,
      slack_median_min: 10,
      slack_worst_min: 20,
      pass: false,
    });
  });

  test("passes a week inside the one-week bar", () => {
    const s = score({
      slack_errors: [5, 10],
      extremum_errors: [10],
      speed_errors: [0.1],
      extrema: 2,
    });
    expect(summarize(s).pass).toBe(true);
  });

  test("fails a week with an invented slack", () => {
    const s = score({
      slack_errors: [5],
      invented: 1,
      extremum_errors: [10],
      speed_errors: [0.1],
      extrema: 1,
    });
    expect(summarize(s).pass).toBe(false);
  });

  test("fails a week with nothing to score", () => {
    expect(summarize(score({})).pass).toBe(false);
  });

  test("flags a reversed axis at 60 % wrong signs", () => {
    expect(summarize(score({ extrema: 5, wrong_sign: 3 })).reversed).toBe(true);
    expect(summarize(score({ extrema: 5, wrong_sign: 2 })).reversed).toBe(false);
  });
});

describe("rounded", () => {
  const errors = (s: Partial<WeekScore>): WeekScore => ({
    slack_errors: [],
    invented: 0,
    extremum_errors: [],
    speed_errors: [],
    extrema: 0,
    wrong_sign: 0,
    ...s,
  });

  test("rounds minutes up to a tenth and knots up to a hundredth, keeping missed slacks", () => {
    const r = rounded(
      errors({
        slack_errors: [1.234, null],
        extremum_errors: [9.876],
        speed_errors: [0.12345],
        extrema: 1,
      }),
    );
    expect(r.slack_errors).toEqual([1.3, null]);
    expect(r.extremum_errors).toEqual([9.9]);
    expect(r.speed_errors).toEqual([0.13]);
  });

  test("never rounds an error down past a bar", () => {
    const r = rounded(errors({ slack_errors: [30.04, 45.04], speed_errors: [0.504] }));
    expect(r.slack_errors).toEqual([30.1, 45.1]);
    expect(r.speed_errors).toEqual([0.51]);
  });

  test("keeps an error already on the grid, float noise included", () => {
    const r = rounded(errors({ slack_errors: [30.0, 15.000000000000002, 0], speed_errors: [0] }));
    expect(r.slack_errors).toEqual([30.0, 15.0, 0]);
    expect(r.speed_errors).toEqual([0]);
  });

  test("fails a week whose raw worst slack is just past the bar", () => {
    const week = errors({
      slack_errors: [5, 5, 30.04],
      extremum_errors: [10],
      speed_errors: [0.1],
      extrema: 1,
    });
    expect(summarize(rounded(week))).toMatchObject({
      slack_median_min: 5,
      slack_worst_min: 30.1,
      extremum_median_min: 10,
      speed_median_kn: 0.1,
      missed: 0,
      invented: 0,
      reversed: false,
      pass: false,
    });
  });
});
