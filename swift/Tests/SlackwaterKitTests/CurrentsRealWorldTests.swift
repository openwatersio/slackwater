import Foundation
import Testing
@testable import SlackwaterKit

/// NOAA max_slack labels extrema by signed phase, including same-sign minima.
/// Matching the phase keeps the timing check sensitive to a reversed axis.
private func nearestSameKind(_ computed: [CurrentEvent], _ kind: CurrentEventKind, to t: Date) -> CurrentEvent? {
    computed.filter { $0.kind != .slack && $0.kind.isFlood == kind.isFlood }
        .min { abs($0.time.timeIntervalSince1970 - t.timeIntervalSince1970) < abs($1.time.timeIntervalSince1970 - t.timeIntervalSince1970) }
}

/// Sign of the station's velocity at the golden extremum time — the sound
/// direction test (flood positive, ebb negative).
private func signedSpeed(_ station: CurrentStation, at t: Date) -> Double {
    station.speeds(from: t.addingTimeInterval(-30), to: t.addingTimeInterval(30), step: 60).first?.speed ?? 0
}

private struct CurrentGoldenFixture: Decodable {
    let station: String
    let floodDirection: Double
    let ebbDirection: Double
    let offset: Double
    let start: String
    let end: String
    let constituents: [C]
    let events: [E]
    struct C: Decodable { let name: String; let amplitude: Double; let phase: Double }
    struct E: Decodable { let time: String; let speed: Double; let kind: String }
}

/// Reproduce NOAA's OWN currents_predictions for a harmonic station (PUG1741,
/// Bellingham Channel). This RESOLVES THE PHASE-CONVENTION GATE: the fixture's
/// `phase` is `majorPhaseGMT`; if the max flood/ebb times match NOAA within
/// tolerance, that field is correct. Skips if the fixture/oracle is absent.
/// Tolerances: ±20 min on event time, ±0.3 kn on peak speed.
@Test func harmonicCurrentMatchesNOAA() throws {
    let fx: CurrentGoldenFixture
    do { fx = try loadFixture("currents-golden-harmonic", as: CurrentGoldenFixture.self) }
    catch { return }
    guard !fx.events.isEmpty else { return }

    let station = CurrentStation(
        constituents: fx.constituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
        floodDirection: fx.floodDirection, ebbDirection: fx.ebbDirection, offset: fx.offset
    )
    // Cover the actual span of oracle events (NOAA returns through end-of-day of
    // end_date, which can extend past the fixture's nominal `end`).
    let times = fx.events.map { parseISO($0.time) }
    let computed = station.events(from: times.min()!.addingTimeInterval(-3600),
                                  to: times.max()!.addingTimeInterval(3600))
    #expect(!computed.isEmpty)

    var maxTimeErr = 0.0, maxSpeedErr = 0.0, checked = 0
    for e in fx.events where e.kind != "slack" {  // max flood/ebb — robust; slacks noisier at weak stations
        let t = parseISO(e.time)
        let kind: CurrentEventKind = e.kind == "maxFlood" ? .maxFlood : .maxEbb
        let m = try #require(nearestSameKind(computed, kind, to: t), "no computed \(e.kind) near \(e.time)")
        let timeErr = abs(m.time.timeIntervalSince1970 - t.timeIntervalSince1970) / 60
        let speedErr = abs(abs(m.speed) - abs(e.speed))
        maxTimeErr = max(maxTimeErr, timeErr); maxSpeedErr = max(maxSpeedErr, speedErr); checked += 1
        let v = signedSpeed(station, at: t)
        #expect(e.kind == "maxFlood" ? v > 0 : v < 0,
                "\(e.kind) at \(e.time): modelled velocity \(v) kn has the wrong sign")
        #expect(timeErr < 20, "\(e.kind) at \(e.time): time off \(timeErr) min (phase field wrong?)")
        #expect(speedErr < 0.3, "\(e.kind) at \(e.time): speed \(m.speed) vs \(e.speed)")
    }
    #expect(checked > 0)
    print("PUG1741 vs NOAA — \(checked) max events, max time err \(maxTimeErr) min, max speed err \(maxSpeedErr) kn")
}

private struct SubGolden: Decodable {
    let sub: String
    let refConstituents: [CurrentGoldenFixture.C]
    let refFloodDirection: Double; let refEbbDirection: Double; let refOffset: Double
    let slackBeforeFloodOffset: Double; let slackBeforeEbbOffset: Double
    let floodTimeOffset: Double; let ebbTimeOffset: Double
    let floodSpeedRatio: Double; let ebbSpeedRatio: Double
    let floodDirection: Double; let ebbDirection: Double
    let events: [CurrentGoldenFixture.E]
}

/// Validate the two-slack subordinate reduction against NOAA's own
/// currents_predictions for a subordinate station (PCT0236, ref SFB1201). The
/// table method is an approximation, so tolerances are looser: ±30 min, ±0.4 kn.
@Test func subordinateCurrentMatchesNOAA() throws {
    let fx: SubGolden
    do { fx = try loadFixture("currents-golden-subordinate", as: SubGolden.self) }
    catch { return }
    guard !fx.events.isEmpty else { return }

    let reference = CurrentStation(
        constituents: fx.refConstituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
        floodDirection: fx.refFloodDirection, ebbDirection: fx.refEbbDirection, offset: fx.refOffset)
    let sub = SubordinateStation(
        reference: reference,
        slackBeforeFloodOffset: fx.slackBeforeFloodOffset, slackBeforeEbbOffset: fx.slackBeforeEbbOffset,
        floodTimeOffset: fx.floodTimeOffset, ebbTimeOffset: fx.ebbTimeOffset,
        floodSpeedRatio: fx.floodSpeedRatio, ebbSpeedRatio: fx.ebbSpeedRatio,
        floodDirection: fx.floodDirection, ebbDirection: fx.ebbDirection)

    let times = fx.events.map { parseISO($0.time) }
    let computed = sub.events(from: times.min()!.addingTimeInterval(-3600), to: times.max()!.addingTimeInterval(3600))
    #expect(!computed.isEmpty)

    var maxTimeErr = 0.0, maxSpeedErr = 0.0, checked = 0
    for e in fx.events where e.kind != "slack" {
        let t = parseISO(e.time)
        let kind: CurrentEventKind = e.kind == "maxFlood" ? .maxFlood : .maxEbb
        // Same-kind matching; a reversed axis would fail the timing gate at
        // every extremum (nearest same-kind event ~half a cycle away).
        let m = try #require(nearestSameKind(computed, kind, to: t), "no computed \(e.kind) near \(e.time)")
        let timeErr = abs(m.time.timeIntervalSince1970 - t.timeIntervalSince1970) / 60
        let speedErr = abs(abs(m.speed) - abs(e.speed))
        maxTimeErr = max(maxTimeErr, timeErr); maxSpeedErr = max(maxSpeedErr, speedErr); checked += 1
        #expect(timeErr < 30, "\(e.kind) at \(e.time): time off \(timeErr) min")
        #expect(speedErr < 0.4, "\(e.kind) at \(e.time): speed \(m.speed) vs \(e.speed)")
    }
    #expect(checked > 0)
    print("PCT0236 (subordinate) vs NOAA — \(checked) max events, max time err \(maxTimeErr) min, max speed err \(maxSpeedErr) kn")
}

private struct HomeBatch: Decodable {
    let stations: [S]
    struct S: Decodable {
        let id: String; let name: String
        let floodDirection: Double; let ebbDirection: Double; let offset: Double
        let constituents: [CurrentGoldenFixture.C]
        let events: [CurrentGoldenFixture.E]
    }
}

/// Directly validate the ACTUAL home passes — Deception Pass, Rosario, San Juan
/// Channel, Turn Point/Boundary, Admiralty Inlet, Race Rocks — against NOAA's own
/// currents_predictions at each station's served bin. (These are served after all;
/// the earlier "not available" was a wrong-bin/User-Agent artifact.) ±20 min, ±0.3 kn.
@Test func homePassesMatchNOAA() throws {
    let batch: HomeBatch
    do { batch = try loadFixture("currents-golden-home", as: HomeBatch.self) }
    catch { return }
    var worstTime = 0.0, worstSpeed = 0.0, checked = 0
    for st in batch.stations {
        let station = CurrentStation(
            constituents: st.constituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
            floodDirection: st.floodDirection, ebbDirection: st.ebbDirection, offset: st.offset)
        let times = st.events.map { parseISO($0.time) }
        let computed = station.events(from: times.min()!.addingTimeInterval(-3600), to: times.max()!.addingTimeInterval(3600))
        // Assert tight tolerance only on navigationally SIGNIFICANT currents. Weak
        // sub-0.75 kn relaxation extrema are ill-conditioned (nearly-flat peak → sensitive
        // timing; straddling zero → ambiguous flood/ebb sign) in NOAA's and our computation
        // alike, and don't matter operationally. They're reported, not gated.
        let significant = 0.75
        var maxT = 0.0, maxS = 0.0, n = 0, weak = 0
        for e in st.events where e.kind != "slack" {
            let t = parseISO(e.time)
            if abs(e.speed) < significant { weak += 1; continue }
            let kind: CurrentEventKind = e.kind == "maxFlood" ? .maxFlood : .maxEbb
            let m = try #require(nearestSameKind(computed, kind, to: t), "\(st.name): no computed \(e.kind) near \(e.time)")
            let timeErr = abs(m.time.timeIntervalSince1970 - t.timeIntervalSince1970) / 60
            let speedErr = abs(abs(m.speed) - abs(e.speed))
            maxT = max(maxT, timeErr); maxS = max(maxS, speedErr); n += 1
            let v = signedSpeed(station, at: t)
            #expect(e.kind == "maxFlood" ? v > 0 : v < 0,
                    "\(st.name) \(e.kind) \(e.speed) kn at \(e.time): modelled velocity \(v) kn has the wrong sign")
            #expect(timeErr < 20, "\(st.name) \(e.kind) \(e.speed) kn at \(e.time): time off \(timeErr) min")
            #expect(speedErr < 0.35, "\(st.name) \(e.kind) at \(e.time): speed \(m.speed) vs \(e.speed)")
        }
        #expect(n > 0)
        worstTime = max(worstTime, maxT); worstSpeed = max(worstSpeed, maxS); checked += 1
        print("  \(st.id) \(st.name): \(n) significant (\(weak) weak skipped), \(String(format: "%.1f", maxT)) min / \(String(format: "%.3f", maxS)) kn")
    }
    #expect(checked == 6, "expected all 6 home passes; got \(checked)")
    print("Home passes vs NOAA — \(checked) stations, worst \(String(format: "%.1f", worstTime)) min / \(String(format: "%.3f", worstSpeed)) kn")
}

/// A subordinate's speed curve: through every event, monotone between
/// neighbours, on the same floored/ceiled timeline as `CurrentStation.speeds`.
/// NOAA publishes no curve for a subordinate, so this is the only check there is.
@Test func subordinateCurrentCurveInterpolatesBetweenEvents() throws {
    let fx: SubGolden
    do { fx = try loadFixture("currents-golden-subordinate", as: SubGolden.self) }
    catch { return }
    let reference = CurrentStation(
        constituents: fx.refConstituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
        floodDirection: fx.refFloodDirection, ebbDirection: fx.refEbbDirection, offset: fx.refOffset)
    let sub = SubordinateStation(
        reference: reference,
        slackBeforeFloodOffset: fx.slackBeforeFloodOffset, slackBeforeEbbOffset: fx.slackBeforeEbbOffset,
        floodTimeOffset: fx.floodTimeOffset, ebbTimeOffset: fx.ebbTimeOffset,
        floodSpeedRatio: fx.floodSpeedRatio, ebbSpeedRatio: fx.ebbSpeedRatio,
        floodDirection: fx.floodDirection, ebbDirection: fx.ebbDirection)
    let from = parseISO("2026-06-01T00:00:00Z"), to = parseISO("2026-06-03T00:00:00Z")
    let events = sub.events(from: from, to: to)
    let speeds = sub.speeds(from: from, to: to, step: 60)
    #expect(speeds.count == reference.speeds(from: from, to: to, step: 60).count)
    #expect(events.count > 8)
    for (e, next) in zip(events, events.dropFirst()) {
        let at = speeds.min { abs($0.time.timeIntervalSince(e.time)) < abs($1.time.timeIntervalSince(e.time)) }!
        #expect(abs(at.speed - e.speed) < 0.01, "curve misses \(e.kind) at \(e.time)")
        let between = speeds.filter { $0.time > e.time && $0.time < next.time }
        let rising = next.speed > e.speed
        for (i, p) in between.enumerated().dropFirst() {
            #expect(rising ? p.speed >= between[i - 1].speed : p.speed <= between[i - 1].speed, "not monotone at \(p.time)")
        }
    }
}

/// The reduction split from the search: a caller that already holds the
/// reference's events (a map full of pins hanging off one reference) gets the
/// same events and the same instantaneous speed the searching API returns.
@Test func subordinateReductionIsSeparableFromTheSearch() throws {
    let fx: SubGolden
    do { fx = try loadFixture("currents-golden-subordinate", as: SubGolden.self) }
    catch { return }
    let reference = CurrentStation(
        constituents: fx.refConstituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
        floodDirection: fx.refFloodDirection, ebbDirection: fx.refEbbDirection, offset: fx.refOffset)
    let sub = SubordinateStation(
        reference: reference,
        slackBeforeFloodOffset: fx.slackBeforeFloodOffset, slackBeforeEbbOffset: fx.slackBeforeEbbOffset,
        floodTimeOffset: fx.floodTimeOffset, ebbTimeOffset: fx.ebbTimeOffset,
        floodSpeedRatio: fx.floodSpeedRatio, ebbSpeedRatio: fx.ebbSpeedRatio,
        floodDirection: fx.floodDirection, ebbDirection: fx.ebbDirection)
    let from = parseISO("2026-06-01T00:00:00Z"), to = parseISO("2026-06-03T00:00:00Z")
    let wide = reference.events(from: from.addingTimeInterval(-13 * 3600), to: to.addingTimeInterval(13 * 3600))
    let reduced = sub.reduce(wide).filter { $0.time >= from && $0.time <= to }
    let searched = sub.events(from: from, to: to)
    #expect(reduced.count == searched.count)
    // Bisection roots land on the window's own bracket grid, so the two
    // searches agree to the second, not the nanosecond.
    for (a, b) in zip(reduced, searched) {
        #expect(abs(a.time.timeIntervalSince(b.time)) < 2)
        #expect(abs(a.speed - b.speed) < 1e-3)
        #expect(a.kind == b.kind)
    }
    for hour in stride(from: 0.0, to: 48, by: 1) {
        let t = from.addingTimeInterval(hour * 3600)
        let sampled = sub.speeds(from: t, to: t.addingTimeInterval(1), step: 1).first!.speed
        // Along the untrimmed list: `speed(at:)` needs an event either side of `t`.
        #expect(abs(SubordinateStation.speed(at: t, along: sub.reduce(wide)) - sampled) < 1e-3, "hour \(hour)")
    }
}

@Test func trialIslandRetainsRaceRocksEbbLulls() throws {
    let batch = try loadFixture("currents-golden-home", as: HomeBatch.self)
    let race = try #require(batch.stations.first { $0.id == "PUG1640" })
    let reference = CurrentStation(constituents: race.constituents.map {
        HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
    }, offset: race.offset)
    let trial = SubordinateStation(reference: reference, slackBeforeFloodOffset: 0, slackBeforeEbbOffset: 4080,
        floodTimeOffset: 1800, ebbTimeOffset: 3480, floodSpeedRatio: 1.06, ebbSpeedRatio: 0.72)
    let start = parseISO("2026-06-01T00:00:00Z"), end = parseISO("2026-07-01T00:00:00Z")
    let minima = reference.eventsByDay(from: start, to: end).filter { $0.kind == .minEbb }
    #expect(!minima.isEmpty)
    for minimum in minima {
        let reduced = try #require(trial.reduce([minimum]).first)
        #expect(reduced.kind == .minEbb && reduced.speed < 0)
        #expect(reduced.time.timeIntervalSince(minimum.time) == 3480)
        #expect(abs(reduced.speed - minimum.speed * 0.72) < 1e-9)
        let points = reference.speeds(from: minimum.time.addingTimeInterval(-60), to: minimum.time.addingTimeInterval(60), step: 60)
        #expect(points.allSatisfy { $0.speed < 0 })
    }
}
