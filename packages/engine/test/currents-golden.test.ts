// Real-world validation against NOAA CO-OPS' own currents_predictions, using
// the golden fixtures shared with the Swift engine. Tolerances are the
// physical-accuracy gates from docs/CONTRACT.md.
import { describe, test, expect } from "vitest";
import {
  createCurrentPredictor,
  createSubordinateCurrentPredictor,
  reduceCurrentEvents,
  currentSpeedAt,
  type CurrentEvent,
  type CurrentEventKind,
  type CurrentPredictor,
} from "../src/index.js";
import {
  loadFixture,
  catalogStation,
  catalogIds,
  type FixtureConstituent,
  type FixtureEvent,
} from "./_mocks/currents-catalog.js";

interface HarmonicGolden {
  station: string;
  floodDirection: number;
  ebbDirection: number;
  offset: number;
  constituents: FixtureConstituent[];
  events: FixtureEvent[];
}

interface SubordinateGolden {
  sub: string;
  refConstituents: FixtureConstituent[];
  refFloodDirection: number;
  refEbbDirection: number;
  refOffset: number;
  slackBeforeFloodOffset: number;
  slackBeforeEbbOffset: number;
  floodTimeOffset: number;
  ebbTimeOffset: number;
  floodSpeedRatio: number;
  ebbSpeedRatio: number;
  floodDirection: number;
  ebbDirection: number;
  events: FixtureEvent[];
}

/**
 * Nearest computed event of the SAME KIND as the golden event. Matching by
 * time alone against a list that includes slacks conflates timing error with
 * direction error; a genuinely reversed axis puts the nearest same-kind event
 * ~half a cycle away, failing the timing gate at every extremum instead of
 * "flipping" a few labels.
 */
function nearestSameKind(
  computed: CurrentEvent[],
  kind: CurrentEventKind,
  time: Date,
): CurrentEvent {
  const candidates = computed.filter((e) => e.kind === kind);
  expect(candidates.length).toBeGreaterThan(0);
  return candidates.reduce((a, b) =>
    Math.abs(a.time.getTime() - time.getTime()) < Math.abs(b.time.getTime() - time.getTime())
      ? a
      : b,
  );
}

/** Sign of the station's velocity at the golden extremum time. */
function signedSpeed(station: CurrentPredictor, time: Date): number {
  return station.getTimelinePrediction({
    start: new Date(time.getTime() - 30_000),
    end: new Date(time.getTime() + 30_000),
    timeFidelity: 60,
  })[0].speed;
}

function eventSpan(events: FixtureEvent[]) {
  const times = events.map((e) => Date.parse(e.time));
  return {
    start: new Date(Math.min(...times) - 3_600_000),
    end: new Date(Math.max(...times) + 3_600_000),
  };
}

/** Compare computed max flood/ebb events with NOAA's, within tolerances. */
function checkEvents(
  computed: CurrentEvent[],
  golden: FixtureEvent[],
  { minutes, knots, significant = 0 }: { minutes: number; knots: number; significant?: number },
): number {
  let checked = 0;
  for (const event of golden) {
    if (event.kind === "slack" || Math.abs(event.speed) < significant) continue;
    const time = new Date(event.time);
    const kind = event.kind as CurrentEventKind;
    const match = nearestSameKind(computed, kind, time);
    const timeErr = Math.abs(match.time.getTime() - time.getTime()) / 60_000;
    const speedErr = Math.abs(Math.abs(match.speed) - Math.abs(event.speed));
    expect(timeErr, `${event.kind} at ${event.time}: time off ${timeErr} min`).toBeLessThan(
      minutes,
    );
    expect(
      speedErr,
      `${event.kind} at ${event.time}: speed ${match.speed} vs ${event.speed}`,
    ).toBeLessThan(knots);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
  return checked;
}

function buildSubordinate(fx: SubordinateGolden) {
  const reference = createCurrentPredictor(fx.refConstituents, {
    floodDirection: fx.refFloodDirection,
    ebbDirection: fx.refEbbDirection,
    meanFlow: fx.refOffset,
  });
  const offsets = {
    slackBeforeFloodOffset: fx.slackBeforeFloodOffset,
    slackBeforeEbbOffset: fx.slackBeforeEbbOffset,
    floodTimeOffset: fx.floodTimeOffset,
    ebbTimeOffset: fx.ebbTimeOffset,
    floodSpeedRatio: fx.floodSpeedRatio,
    ebbSpeedRatio: fx.ebbSpeedRatio,
    floodDirection: fx.floodDirection,
    ebbDirection: fx.ebbDirection,
  };
  return { reference, offsets, sub: createSubordinateCurrentPredictor(reference, offsets) };
}

// Reproduce NOAA's own currents_predictions for a harmonic station (PUG1741,
// Bellingham Channel). The fixture's phase is majorPhaseGMT; the timing match
// confirms that convention. ±20 min on event time, ±0.3 kn on peak speed.
test("harmonic current matches NOAA (PUG1741)", () => {
  const fx = loadFixture<HarmonicGolden>("currents-golden-harmonic");
  const station = createCurrentPredictor(fx.constituents, {
    floodDirection: fx.floodDirection,
    ebbDirection: fx.ebbDirection,
    meanFlow: fx.offset,
  });
  const computed = station.getEventsPrediction(eventSpan(fx.events));

  checkEvents(computed, fx.events, { minutes: 20, knots: 0.3 });
  for (const event of fx.events) {
    if (event.kind === "slack") continue;
    const v = signedSpeed(station, new Date(event.time));
    expect(
      event.kind === "maxFlood" ? v > 0 : v < 0,
      `${event.kind} at ${event.time}: modelled velocity ${v} kn has the wrong sign`,
    ).toBe(true);
  }
});

// Validate the two-slack subordinate reduction against NOAA's own predictions
// for a subordinate station (PCT0236, ref SFB1201). The table method is an
// approximation, so tolerances are looser: ±30 min, ±0.4 kn.
test("subordinate current matches NOAA (PCT0236)", () => {
  const fx = loadFixture<SubordinateGolden>("currents-golden-subordinate");
  const { sub } = buildSubordinate(fx);
  const computed = sub.getEventsPrediction(eventSpan(fx.events));
  checkEvents(computed, fx.events, { minutes: 30, knots: 0.4 });
});

// Directly validate the home passes — Deception Pass, Rosario, San Juan
// Channel, Turn Point/Boundary, Admiralty Inlet, Race Rocks — against NOAA's
// own predictions at each station's served bin. Tight tolerance only on
// navigationally significant currents (≥ 0.75 kn): weak relaxation extrema
// are ill-conditioned in NOAA's computation too. ±20 min, ±0.35 kn.
test("home passes match NOAA", () => {
  const batch = loadFixture<{ stations: (HarmonicGolden & { id: string })[] }>(
    "currents-golden-home",
  );
  let checked = 0;
  for (const st of batch.stations) {
    const station = createCurrentPredictor(st.constituents, {
      floodDirection: st.floodDirection,
      ebbDirection: st.ebbDirection,
      meanFlow: st.offset,
    });
    const computed = station.getEventsPrediction(eventSpan(st.events));
    checkEvents(computed, st.events, { minutes: 20, knots: 0.35, significant: 0.75 });
    for (const event of st.events) {
      if (event.kind === "slack" || Math.abs(event.speed) < 0.75) continue;
      const v = signedSpeed(station, new Date(event.time));
      expect(
        event.kind === "maxFlood" ? v > 0 : v < 0,
        `${st.id} ${event.kind} at ${event.time}: modelled velocity ${v} kn has the wrong sign`,
      ).toBe(true);
    }
    checked++;
  }
  expect(checked, "expected all 6 home passes").toBe(6);
});

// The nine-station subordinate batch: regions, offset signs, ratios 0.2–1.5.
test("subordinate batch matches NOAA", () => {
  const batch = loadFixture<{ stations: { id: string; events: FixtureEvent[] }[] }>(
    "currents-golden-sub-batch",
  );
  let stationsChecked = 0;
  for (const record of batch.stations) {
    const station = catalogStation(record.id);
    expect(station, record.id).toBeDefined();
    expect(station!.type).toBe("subordinate");
    const computed = station!.predictor.getEventsPrediction(eventSpan(record.events));
    checkEvents(computed, record.events, { minutes: 30, knots: 0.4 });
    stationsChecked++;
  }
  expect(stationsChecked, "expected the full batch").toBeGreaterThanOrEqual(8);
});

describe("sampled catalog", () => {
  test("loads and predicts", () => {
    expect(catalogIds().length).toBeGreaterThan(0);
    const station = catalogStation("PUG1701");
    expect(station, "Deception Pass should be sampled").toBeDefined();
    const start = new Date("2026-06-01T00:00:00Z");
    const end = new Date("2026-06-02T00:00:00Z");
    const events = station!.predictor.getEventsPrediction({ start, end });
    expect(events.some((e) => e.kind === "maxFlood")).toBe(true);
    expect(events.some((e) => e.kind === "maxEbb")).toBe(true);

    const subordinate = catalogStation("PCT1321");
    expect(subordinate?.type, "PCT1321 should load as a subordinate station").toBe("subordinate");
    expect(subordinate!.predictor.getEventsPrediction({ start, end }).length).toBeGreaterThan(0);

    // PUG1716 has its own harcon and predicts harmonically, not by reduction.
    expect(catalogStation("PUG1716")?.type).toBe("harmonic");
    expect(catalogStation("NOT_A_STATION")).toBeUndefined();
  });
});

// A subordinate's speed curve: through every event, monotone between
// neighbours, on the same floored/ceiled timeline as the harmonic timeline.
// NOAA publishes no curve for a subordinate, so this is the only check.
test("subordinate curve interpolates between events", () => {
  const fx = loadFixture<SubordinateGolden>("currents-golden-subordinate");
  const { reference, sub } = buildSubordinate(fx);
  const start = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-06-03T00:00:00Z");
  const events = sub.getEventsPrediction({ start, end });
  const speeds = sub.getTimelinePrediction({ start, end, timeFidelity: 60 });
  expect(speeds.length).toBe(
    reference.getTimelinePrediction({ start, end, timeFidelity: 60 }).length,
  );
  expect(events.length).toBeGreaterThan(8);

  for (let i = 0; i < events.length - 1; i++) {
    const event = events[i];
    const next = events[i + 1];
    const at = speeds.reduce((a, b) =>
      Math.abs(a.time.getTime() - event.time.getTime()) <
      Math.abs(b.time.getTime() - event.time.getTime())
        ? a
        : b,
    );
    expect(at.speed, `curve misses ${event.kind} at ${event.time.toISOString()}`).toBeWithin(
      event.speed,
      0.01,
    );
    const between = speeds.filter((p) => p.time > event.time && p.time < next.time);
    const rising = next.speed > event.speed;
    for (let j = 1; j < between.length; j++) {
      expect(
        rising
          ? between[j].speed >= between[j - 1].speed
          : between[j].speed <= between[j - 1].speed,
        `not monotone at ${between[j].time.toISOString()}`,
      ).toBe(true);
    }
  }
});

// The reduction split from the search: a caller that already holds the
// reference's events (a map full of pins hanging off one reference) gets the
// same events and the same instantaneous speed the searching API returns.
test("subordinate reduction is separable from the search", () => {
  const fx = loadFixture<SubordinateGolden>("currents-golden-subordinate");
  const { reference, offsets, sub } = buildSubordinate(fx);
  const start = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-06-03T00:00:00Z");
  const wide = reference.getEventsPrediction({
    start: new Date(start.getTime() - 13 * 3_600_000),
    end: new Date(end.getTime() + 13 * 3_600_000),
  });
  const reduced = reduceCurrentEvents(wide, offsets).filter(
    (e) => e.time >= start && e.time <= end,
  );
  const searched = sub.getEventsPrediction({ start, end });
  expect(reduced.length).toBe(searched.length);
  for (let i = 0; i < reduced.length; i++) {
    // Bisection roots land on the window's own bracket grid, so the two
    // searches agree to the second, not the millisecond.
    expect(Math.abs(reduced[i].time.getTime() - searched[i].time.getTime())).toBeLessThan(2000);
    expect(reduced[i].speed).toBeWithin(searched[i].speed, 1e-3);
    expect(reduced[i].kind).toBe(searched[i].kind);
  }

  for (let hour = 0; hour < 48; hour++) {
    const t = new Date(start.getTime() + hour * 3_600_000);
    const sampled = sub.getTimelinePrediction({
      start: t,
      end: new Date(t.getTime() + 1000),
      timeFidelity: 1,
    })[0].speed;
    // Along the untrimmed list: the half-cosine needs an event either side.
    expect(currentSpeedAt(reduceCurrentEvents(wide, offsets), t), `hour ${hour}`).toBeWithin(
      sampled,
      1e-3,
    );
  }
});

// Regression: an 8 h reference search and a 24 h one can disagree on events —
// the extrema filter skips a window holding two or fewer results — which once
// gave ACT8791 −0.18 vs −0.40 kn at the same instant. Event extraction is per
// UTC day, so any range's list is a concatenation of per-day lists, and a
// held list agrees with the search for every bundled subordinate.
test("subordinate curve is window invariant", () => {
  const t = new Date("2026-03-07T06:00:00Z");
  let checked = 0;
  let worst = 0;
  let worstId = "";
  for (const id of catalogIds()) {
    const station = catalogStation(id);
    if (station?.type !== "subordinate") continue;
    const held = station.reference!.getEventsPrediction({
      start: new Date(t.getTime() - 24 * 3_600_000),
      end: new Date(t.getTime() + 24 * 3_600_000),
    });
    const viaHeld = currentSpeedAt(reduceCurrentEvents(held, station.offsets!), t);
    const viaSearch = station.predictor.getTimelinePrediction({
      start: t,
      end: new Date(t.getTime() + 1000),
      timeFidelity: 1,
    })[0].speed;
    const err = Math.abs(viaHeld - viaSearch);
    if (err > worst) {
      worst = err;
      worstId = id;
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
  expect(worst, `${worstId} differs between a held list and the search`).toBeLessThan(1e-3);

  // The per-day lists themselves: a day's events do not depend on the range.
  const act8791 = catalogStation("ACT8791");
  expect(act8791?.type).toBe("subordinate");
  const day = new Date("2026-03-07T00:00:00Z");
  const dayEnd = new Date(day.getTime() + 86_400_000);
  const narrow = act8791!.reference!.getEventsPrediction({
    start: day,
    end: new Date(dayEnd.getTime() - 1000),
  });
  const wide = act8791!
    .reference!.getEventsPrediction({
      start: new Date(day.getTime() - 5 * 86_400_000),
      end: new Date(day.getTime() + 5 * 86_400_000),
    })
    .filter((e) => e.time >= day && e.time < dayEnd);
  expect(narrow.length).toBe(wide.length);
  for (let i = 0; i < narrow.length; i++) {
    expect(narrow[i].time).toEqual(wide[i].time);
    expect(narrow[i].speed).toBe(wide[i].speed);
  }
});
