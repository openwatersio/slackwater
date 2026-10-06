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
    RawExtreme(hour: hour, time: Date(timeIntervalSince1970: hour * 3600), level: level, high: high)
}

@Test func filterRemovesAStandAsALowHighPair() {
    let got = filterExtremes([raw(0, -0.926, false), raw(8, 0.945, true), raw(17, -0.112, false),
                              raw(17.5, -0.109, true), raw(24, -0.72, false)], prominenceThreshold: 0.01)
    #expect(got.map(\.level) == [-0.926, 0.945, -0.72])
}

@Test func filterKeepsTheHigherHighOfAShallowDoubleHigh() {
    let got = filterExtremes([raw(0, 0, false), raw(6, 1.002, true), raw(7, 0.995, false),
                              raw(8, 1.0, true), raw(14, 0, false)], prominenceThreshold: 0.01)
    #expect(got.map(\.level) == [0, 1.002, 0])
}

@Test func filterDropsOneCopyOfATurnFoundTwice() {
    let got = filterExtremes([raw(0, -0.4, false), raw(7.6, 0.03, true), raw(7.6005, 0.03, true),
                              raw(10.4, -0.008, false)], prominenceThreshold: 0.01)
    #expect(got.map(\.high) == [false, true, false])
}

// Minimal decode of the prediction fixture's constituent list, reused here.
struct PredictionFixtureRef: Decodable {
    let constituents: [C]
    struct C: Decodable { let name: String; let amplitude: Double; let phase: Double }
}
