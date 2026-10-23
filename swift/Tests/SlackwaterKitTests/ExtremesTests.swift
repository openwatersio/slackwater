import Foundation
import Testing
@testable import SlackwaterKit

private struct ExtremesFixture: Decodable {
    let start: String
    let end: String
    let extremes: [E]
    struct E: Decodable { let time: String; let height: Double; let kind: String }
}

@Test func extremesMatchSlackwater() throws {
    // Reuse the prediction fixture's constituent set (same station/window).
    let pred = try loadFixture("prediction-victoria", as: PredictionFixtureRef.self)
    let fixture = try loadFixture("extremes-victoria", as: ExtremesFixture.self)
    let station = Station(constituents: pred.constituents.map {
        HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
    })
    let got = station.extremes(from: parseISO(fixture.start), to: parseISO(fixture.end))

    #expect(got.count == fixture.extremes.count, "extreme count: got \(got.count), want \(fixture.extremes.count)")
    for (g, e) in zip(got, fixture.extremes) {
        #expect((g.kind == .high ? "high" : "low") == e.kind, "kind at \(e.time): got \(g.kind), want \(e.kind)")
        let dt = abs(g.time.timeIntervalSince1970 - parseISO(e.time).timeIntervalSince1970)
        #expect(dt < 60, "time at \(e.time): off by \(dt)s")
        #expect(abs(g.height - e.height) < 0.02, "height at \(e.time): got \(g.height), want \(e.height)")
    }
}

// Victoria-like mixed tide, alone and with enough M4 + MS4 to meet the Doodson double-tide criterion.
private let mixedTide = [("M2", 0.37, 20.0), ("S2", 0.1, 40), ("N2", 0.09, 355), ("K2", 0.03, 40),
                         ("K1", 0.63, 260), ("O1", 0.38, 240), ("P1", 0.19, 258), ("Q1", 0.07, 235)]
private let shallowWater = [("M4", 0.08, 100.0), ("MS4", 0.03, 150)]

@Test(arguments: [mixedTide, mixedTide + shallowWater])
func extremesAlternateOverNineteenYearsOfMixedTide(_ set: [(String, Double, Double)]) {
    let station = Station(constituents: set.map { HarmonicConstituent(name: $0.0, amplitude: $0.1, phase: $0.2) })
    let got = station.extremes(from: parseISO("2020-01-01T00:00:00Z"), to: parseISO("2039-01-01T00:00:00Z"))
    let repeats = zip(got, got.dropFirst()).filter { $0.kind == $1.kind }
    #expect(repeats.isEmpty, "first repeat: \(String(describing: repeats.first))")
}

private func raw(_ hour: Double, _ level: Double, _ high: Bool) -> RawExtreme {
    RawExtreme(time: Date(timeIntervalSince1970: hour * 3600), level: level, high: high)
}

/// A tall turn of the other kind on each side decides the list's own ends;
/// the frame itself has nothing beyond it and is dropped.
private func framed(_ list: [RawExtreme]) -> [RawExtreme] {
    let first = list.first!, last = list.last!
    let hour = { (e: RawExtreme) in e.time.timeIntervalSince1970 / 3600 }
    return [raw(hour(first) - 6, first.high ? -10 : 10, !first.high)] + list
        + [raw(hour(last) + 6, last.high ? -10 : 10, !last.high)]
}

@Test func filterRemovesAStandAsALowHighPair() {
    let got = filterExtremes(framed([raw(0, -0.926, false), raw(8, 0.945, true), raw(17, -0.112, false),
                                     raw(17.5, -0.109, true), raw(24, -0.72, false)]), prominenceThreshold: 0.01)
    #expect(got.map(\.level) == [-0.926, 0.945, -0.72])
}

@Test func filterKeepsTheHigherHighOfAShallowDoubleHigh() {
    let got = filterExtremes(framed([raw(0, 0, false), raw(6, 1.002, true), raw(7, 0.995, false),
                                     raw(8, 1.0, true), raw(14, 0, false)]), prominenceThreshold: 0.01)
    #expect(got.map(\.level) == [0, 1.002, 0])
}

@Test func filterKeepsADoubleHighWhoseDipClearsTheThreshold() {
    let input = [raw(0, 0, false), raw(6, 1.0, true), raw(7, 0.95, false), raw(8, 1.02, true), raw(14, 0, false)]
    #expect(filterExtremes(framed(input), prominenceThreshold: 0.01).map(\.level) == input.map(\.level))
}

@Test func filterDropsAnExtremeWhoseDecidingTurnLiesBeyondTheList() {
    let got = filterExtremes([raw(0, 0, false), raw(6, 1.002, true), raw(7, 0.995, false)], prominenceThreshold: 0.01)
    #expect(!got.map(\.level).contains(1.002))
}

@Test func filterDecidesEachExtremeFromTurnsWithin32Days() {
    func dipAt(_ hour: Double) -> [Double] {
        filterExtremes([raw(-6, -1, false), raw(0, 0.5, true), raw(6, 0.497, false), raw(12, 0.499, true),
                        raw(hour, 0.4, false), raw(hour + 6, 1, true)], prominenceThreshold: 0.01).map(\.level)
    }
    #expect(dipAt(32 * 24 - 1).contains(0.5))
    #expect(!dipAt(32 * 24 + 1).contains(0.5))
}

// A gauge whose every turn is a few millimetres, like the Great Lakes and the
// upper St Lawrence: runs of turns below the 1 cm filter last for days.
private let subCentimetre = Station(constituents: [
    HarmonicConstituent(name: "M2", amplitude: 0.002, phase: 40),
    HarmonicConstituent(name: "K1", amplitude: 0.0025, phase: 110),
    HarmonicConstituent(name: "O1", amplitude: 0.0015, phase: 300),
    HarmonicConstituent(name: "S2", amplitude: 0.001, phase: 75),
])

@Test func anAnnualTideKeepsItsTurnsMonthsApart() {
    let annual = Station(constituents: [HarmonicConstituent(name: "SA", amplitude: 1, phase: 40)])
    let year = annual.extremes(from: parseISO("2026-01-01T00:00:00Z"), to: parseISO("2027-01-01T00:00:00Z"))
    #expect(year.map(\.kind) == [.high, .low])
}

@Test func extremesDoNotDependOnTheWindowAskedFor() throws {
    let pred = try loadFixture("prediction-victoria", as: PredictionFixtureRef.self)
    let victoria = Station(constituents: pred.constituents.map {
        HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
    })
    let t0 = parseISO("2026-08-01T20:00:00Z")
    for station in [subCentimetre, victoria] {
        let long = station.extremes(from: t0.addingTimeInterval(-24 * 3600), to: t0.addingTimeInterval(96 * 3600))
        #expect(long.count > 1, "turns to compare")
        for offset in [0.0, 1, 7, 13, 19] {
            for hours in [13.0, 30, 48] {
                let from = t0.addingTimeInterval(offset * 3600), to = from.addingTimeInterval(hours * 3600)
                let short = station.extremes(from: from, to: to)
                let expected = long.filter { $0.time >= from && $0.time <= to }
                #expect(short.map(\.time) == expected.map(\.time), "\(hours) h from +\(offset) h")
                #expect(short.map(\.kind) == expected.map(\.kind), "\(hours) h from +\(offset) h")
            }
        }
    }
}

// M4 just over a quarter of M2 and in opposition splits every high into two with a
// dip of a few millimetres; the faint M8 shortens the bracket enough to resolve it.
private let doubleHigh = Station(constituents: [
    HarmonicConstituent(name: "M2", amplitude: 1, phase: 0),
    HarmonicConstituent(name: "M4", amplitude: 0.29, phase: 180.5),
    HarmonicConstituent(name: "M8", amplitude: 0.001, phase: 0),
])

// On 2025-01-01 the double highs fall at 00:18 / 01:18 / 02:04 and 12:43 / 13:44 / 14:29:
// windows that start before and after a dip, then end before and after one.
@Test(arguments: zip(["2025-01-01T01:00:00Z", "2025-01-01T02:00:00Z", "2025-01-01T06:00:00Z", "2025-01-01T06:00:00Z"],
                     ["2025-01-01T10:00:00Z", "2025-01-01T10:00:00Z", "2025-01-01T13:10:00Z", "2025-01-01T14:00:00Z"]))
func extremesNearADoubleHighMatchALongerRun(start: String, end: String) {
    let from = parseISO(start), to = parseISO(end)
    let long = doubleHigh.extremes(from: parseISO("2024-12-31T00:00:00Z"), to: parseISO("2025-01-03T00:00:00Z"))
        .filter { $0.time >= from && $0.time <= to }
    let short = doubleHigh.extremes(from: from, to: to)
    #expect(short.map(\.kind) == long.map(\.kind))
    for (s, l) in zip(short, long) {
        #expect(abs(s.time.timeIntervalSince1970 - l.time.timeIntervalSince1970) < 5, "time at \(l.time)")
        #expect(abs(s.height - l.height) < 1e-4, "height at \(l.time)")
    }
}

@Test func filterDropsOneCopyOfATurnFoundTwice() {
    let got = filterExtremes(framed([raw(0, -0.4, false), raw(7.6, 0.03, true), raw(7.6005, 0.03, true),
                                     raw(10.4, -0.008, false)]), prominenceThreshold: 0.01)
    #expect(got.map(\.high) == [false, true, false])
}

/// Cambridge, MD puts the low of 26 July 2026 on 00:00 UTC, a second apart under each
/// day's parameters: it is found once, and the high before it is kept.
@Test func aTurnOnUtcMidnightIsFoundOnce() throws {
    let pred = try loadFixture("extremes-midnight", as: PredictionFixtureRef.self)
    let fixture = try loadFixture("extremes-midnight", as: ExtremesFixture.self)
    let station = Station(constituents: pred.constituents.map {
        HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
    })
    let got = station.extremes(from: parseISO(fixture.start), to: parseISO(fixture.end))
    #expect(got.count == fixture.extremes.count, "extreme count: got \(got.count), want \(fixture.extremes.count)")
    for (g, e) in zip(got, fixture.extremes) {
        #expect((g.kind == .high ? "high" : "low") == e.kind, "kind at \(e.time)")
        #expect(abs(g.time.timeIntervalSince1970 - parseISO(e.time).timeIntervalSince1970) < 60, "time at \(e.time)")
        #expect(abs(g.height - e.height) < 0.02, "height at \(e.time)")
    }
}

// Minimal decode of the prediction fixture's constituent list, reused here.
struct PredictionFixtureRef: Decodable {
    let constituents: [C]
    struct C: Decodable { let name: String; let amplitude: Double; let phase: Double }
}

/// Knots must surround every window: past the last one the curve would hold flat, rate 0.
@Test func aSubordinateOfAMicroTidalReferenceKeepsMovingAcrossEveryWindow() {
    let subordinate = SubordinateTideStation(reference: subCentimetre, highTimeOffset: 0, lowTimeOffset: 0,
                                             height: .ratio(high: 1, low: 1))
    let t0 = parseISO("2026-01-01T00:00:00Z")
    for day in 0..<20 {
        let from = t0.addingTimeInterval(Double(day) * 86_400), to = from.addingTimeInterval(86_400)
        let rates = subordinate.rates(from: from, to: to)
        #expect(rates.first!.rate != 0 && rates.last!.rate != 0, "day \(day)")
    }
}

@Test func aSubordinateCurveSurroundsItsSnappedTimeline() throws {
    // A kept extreme just before `from`, but after the 10-minute sample `from` snaps down
    // to, with the one before it out of reach of the 15-hour pad and the next within it.
    let subordinate = SubordinateTideStation(reference: subCentimetre, highTimeOffset: 0, lowTimeOffset: 0,
                                             height: .ratio(high: 1, low: 1))
    let t0 = parseISO("2026-01-01T00:00:00Z")
    let kept = subordinate.extremes(from: t0, to: t0.addingTimeInterval(120 * 86_400))
    var found: TideExtreme?
    for i in 1..<(kept.count - 1) {
        let e = kept[i]
        let afterPrevious = e.time.timeIntervalSince(kept[i - 1].time)
        let beforeNext = kept[i + 1].time.timeIntervalSince(e.time)
        let offGrid = e.time.timeIntervalSince1970.truncatingRemainder(dividingBy: 600) > 1
        if afterPrevious > 16 * 3600 && beforeNext < 14 * 3600 && offGrid { found = e; break }
    }
    let knot = try #require(found)
    let from = knot.time.addingTimeInterval(1)
    let rates = subordinate.rates(from: from, to: from)
    #expect(rates.first!.time < knot.time)
    #expect(rates.first!.rate != 0)
}
