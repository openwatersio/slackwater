import Foundation
import Testing
@testable import SlackwaterKit

// A pure single-M2 current: v(t) = cos(w·t + φ). Slacks are the zeros of cos,
// every half period. M2 speed ≈ 28.9841042°/h → period T ≈ 12.4206 h, slacks
// every T/2 ≈ 6.2103 h. Predict slack instants independent of the engine.
@Test func slackFinderMatchesAnalyticM2() throws {
    let start = parseISO("2026-01-01T00:00:00Z")
    let end = parseISO("2026-01-03T00:00:00Z")
    let cs = [StationConstituent(name: "M2", amplitude: 1.0, phase: Double.pi / 2)]
    let base = astro(start)
    let startMs = start.timeIntervalSince1970 * 1000
    let endHour = (end.timeIntervalSince1970 - start.timeIntervalSince1970) / 3600
    let provider = ParamProvider(constituents: cs, baseAstro: base, catalog: .shared,
                                 startMs: startMs, endHour: endHour)

    let slacks = findSlacks(fromHour: 0, toHour: endHour, provider: provider)

    // ~48 h / (M2 half-period 6.2103 h) ≈ 7–8 zero crossings.
    #expect(slacks.count >= 7 && slacks.count <= 9, "slack count \(slacks.count)")
    for s in slacks {
        #expect(abs(s.speed) < 1e-3, "slack at \(s.time) has speed \(s.speed), not ~0")
    }
    for i in 1..<slacks.count {
        let gap = slacks[i].hour - slacks[i - 1].hour
        #expect(abs(gap - 6.2103) < 0.1, "slack gap \(gap) h at index \(i)")
    }
}

// A reversing current from a couple of constituents. Assert only structural
// invariants true for any correct reversing current — no external oracle needed.
@Test func currentStationStructureIsConsistent() throws {
    let station = CurrentStation(
        constituents: [
            HarmonicConstituent(name: "M2", amplitude: 2.0, phase: 40),
            HarmonicConstituent(name: "K1", amplitude: 0.5, phase: 200)
        ],
        floodDirection: 120, ebbDirection: 300
    )
    let start = parseISO("2026-03-01T00:00:00Z")
    let end = parseISO("2026-03-02T00:00:00Z")

    let speeds = station.speeds(from: start, to: end, step: 600)
    #expect(!speeds.isEmpty)
    let maxAbs = speeds.map { abs($0.speed) }.max()!
    #expect(maxAbs > 1.0, "reversing current should reach real speed, got \(maxAbs)")

    let maxima = station.maxima(from: start, to: end)
    #expect(maxima.allSatisfy { $0.kind == .maxFlood || $0.kind == .maxEbb })
    #expect(maxima.contains { $0.kind == .maxFlood } && maxima.contains { $0.kind == .maxEbb })
    for m in maxima {
        if m.kind == .maxFlood { #expect(m.speed > 0, "flood peak \(m.speed) not positive") }
        if m.kind == .maxEbb { #expect(m.speed < 0, "ebb peak \(m.speed) not negative") }
    }

    let slacks = station.slacks(from: start, to: end)
    #expect(slacks.allSatisfy { $0.kind == .slack && abs($0.speed) < 1e-3 })

    let events = station.events(from: start, to: end)
    for i in 1..<events.count {
        #expect(events[i].time >= events[i - 1].time, "events out of order at \(i)")
    }
}

// NOAA's subordinate reduction: two slack offsets (before-flood, before-ebb),
// two peak time offsets, two speed ratios. A slack is shifted by the offset that
// matches the phase it precedes (its next non-slack event's kind).
@Test func subordinateReductionShiftsAndScales() throws {
    let reference = CurrentStation(
        constituents: [HarmonicConstituent(name: "M2", amplitude: 2.0, phase: 40)],
        floodDirection: 100, ebbDirection: 280
    )
    let start = parseISO("2026-03-01T00:00:00Z")
    let end = parseISO("2026-03-02T00:00:00Z")

    let sub = SubordinateStation(
        reference: reference,
        slackBeforeFloodOffset: 600, slackBeforeEbbOffset: -900,
        floodTimeOffset: -1800, ebbTimeOffset: 1200,
        floodSpeedRatio: 1.5, ebbSpeedRatio: 0.8,
        floodDirection: 110, ebbDirection: 290
    )

    let subEvents = sub.events(from: start, to: end)
    #expect(!subEvents.isEmpty)

    // Sign-consistent labels; slacks are exactly zero.
    for se in subEvents {
        switch se.kind {
        case .maxFlood, .minFlood: #expect(se.speed > 0)
        case .maxEbb, .minEbb:   #expect(se.speed < 0)
        case .slack:    #expect(abs(se.speed) < 1e-9, "slack speed must be 0")
        }
    }

    // Flood peaks: reconstruct expected time/speed from the reference (undo the
    // -1800 s flood time offset, expect speed × 1.5). Reference over a wide window
    // so the pre-image is present; node-correction midpoints differ by a hair, so
    // speeds match to ~1e-3 kn.
    let refFlood = reference.maxima(from: start.addingTimeInterval(-7200), to: end.addingTimeInterval(7200))
        .filter { $0.kind == .maxFlood }
    let subFlood = subEvents.filter { $0.kind == .maxFlood }
    #expect(!subFlood.isEmpty)
    for sf in subFlood {
        let orig = sf.time.addingTimeInterval(1800)
        let r = try #require(refFlood.min { abs($0.time.timeIntervalSince1970 - orig.timeIntervalSince1970) < abs($1.time.timeIntervalSince1970 - orig.timeIntervalSince1970) })
        #expect(abs(r.time.timeIntervalSince1970 - orig.timeIntervalSince1970) < 2, "flood time shift")
        #expect(abs(sf.speed - r.speed * 1.5) < 1e-3, "flood speed scale")
    }
}

@Test func biasedCurrentsKeepSameSignMinima() throws {
    let start = parseISO("2026-03-01T00:00:00Z")
    let end = start.addingTimeInterval(86400)
    for mean in [2.0, -2.0] {
        let station = CurrentStation(constituents: [HarmonicConstituent(name: "S2", amplitude: 1, phase: 0)], offset: mean)
        let events = station.events(from: start, to: end)
        #expect(events.count >= 3)
        #expect(!events.contains { $0.kind == .slack })
        let minima = events.filter { abs($0.speed) < 2 }
        #expect(!minima.isEmpty)
        for event in minima {
            #expect(String(describing: event.kind) == (mean > 0 ? "minFlood" : "minEbb"))
            #expect(abs(abs(event.speed) - 1) < 0.001)
        }
        let peaks = station.maxima(from: start, to: end)
        #expect(peaks.count < events.count)
        #expect(peaks.allSatisfy { $0.kind == (mean > 0 ? .maxFlood : .maxEbb) })
    }
}

@Test func subordinateMinimaUseSignedPhaseCorrectionsAndRemainCurveKnots() throws {
    let start = parseISO("2026-03-01T00:00:00Z")
    let reference = CurrentStation(constituents: [HarmonicConstituent(name: "S2", amplitude: 1, phase: 0)], offset: 2)
    let sub = SubordinateStation(reference: reference, slackBeforeFloodOffset: 600, slackBeforeEbbOffset: -900,
        floodTimeOffset: 120, ebbTimeOffset: -240, floodSpeedRatio: 1.5, ebbSpeedRatio: 0.8)
    for sign in [1.0, -1.0] {
        let ref = CurrentStation(constituents: [HarmonicConstituent(name: "S2", amplitude: 1, phase: 0)], offset: sign * 2)
        let source = ref.events(from: start, to: start.addingTimeInterval(86400))
        let reduced = sub.reduce(source)
        for (event, result) in zip(source, reduced) {
            #expect(event.kind == result.kind)
            #expect(abs(result.time.timeIntervalSince(event.time) - (sign > 0 ? 120 : -240)) < 0.001)
            #expect(abs(result.speed - event.speed * (sign > 0 ? 1.5 : 0.8)) < 1e-9)
            #expect(abs(SubordinateStation.speed(at: result.time, along: reduced) - result.speed) < 1e-9)
        }
    }
}

@Test func subordinateSlackPhaseUsesNextMaximum() throws {
    let time = parseISO("2026-03-01T00:00:00Z")
    let reference = CurrentStation(constituents: [])
    let sub = SubordinateStation(reference: reference, slackBeforeFloodOffset: 600, slackBeforeEbbOffset: -900,
        floodTimeOffset: 0, ebbTimeOffset: 0, floodSpeedRatio: 1, ebbSpeedRatio: 1)
    let events = [CurrentEvent(time: time, speed: 0, kind: .slack),
        CurrentEvent(time: time.addingTimeInterval(3600), speed: 0.1, kind: .minFlood),
        CurrentEvent(time: time.addingTimeInterval(7200), speed: -2, kind: .maxEbb)]
    let slack = try #require(sub.reduce(events).first { $0.kind == .slack })
    #expect(slack.time.timeIntervalSince(time) == -900)
}

private struct CurrentMinimumOffsetsFixture: Decodable {
    let speedToleranceKnots: Double
    let offsets: Offsets
    let events: [Event]
    struct Offsets: Decodable {
        let slackBeforeFloodOffset: Double; let slackBeforeEbbOffset: Double
        let floodTimeOffset: Double; let ebbTimeOffset: Double
        let floodSpeedRatio: Double; let ebbSpeedRatio: Double
    }
    struct Event: Decodable {
        let referenceTime: String; let referenceSpeed: Double; let kind: String
        let subordinateTime: String; let subordinateSpeed: Double
    }
}

@Test func subordinateMinimumMatchesPublishedNOAATable() throws {
    let fixture = try loadFixture("current-minimum-offsets", as: CurrentMinimumOffsetsFixture.self)
    let offsets = fixture.offsets
    let subordinate = SubordinateStation(reference: CurrentStation(constituents: []),
        slackBeforeFloodOffset: offsets.slackBeforeFloodOffset,
        slackBeforeEbbOffset: offsets.slackBeforeEbbOffset,
        floodTimeOffset: offsets.floodTimeOffset, ebbTimeOffset: offsets.ebbTimeOffset,
        floodSpeedRatio: offsets.floodSpeedRatio, ebbSpeedRatio: offsets.ebbSpeedRatio)
    #expect(fixture.events.count == 2)
    for event in fixture.events {
        let reference = CurrentEvent(time: parseISO(event.referenceTime), speed: event.referenceSpeed,
                                     kind: try currentEventKind(event.kind))
        let reduced = try #require(subordinate.reduce([reference]).first)
        #expect(reduced.kind == .minEbb)
        #expect(reduced.time == parseISO(event.subordinateTime))
        #expect(abs(reduced.speed - event.subordinateSpeed) <= fixture.speedToleranceKnots)
        #expect(reduced.time != reference.time.addingTimeInterval(offsets.slackBeforeEbbOffset))
    }
}
