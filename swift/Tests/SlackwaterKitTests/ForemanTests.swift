import Foundation
import Testing
@testable import SlackwaterKit

private struct UtideEntry: Decodable { let time: String; let latitude: Double; let values: [String: [Double]] }

private struct ForemanFixture: Decodable {
    let constituents: [Constituent]
    let start: String
    let end: String
    let step: Double
    let cases: [Case]
    let refused: [String: String]
    struct Constituent: Decodable { let name: String; let amplitude: Double; let phase: Double }
    struct Case: Decodable { let latitude: Double; let points: [Point]; let extremes: [Extreme] }
    struct Point: Decodable { let time: String; let height: Double }
    struct Extreme: Decodable { let time: String; let height: Double; let kind: String }

    var harmonics: [HarmonicConstituent] {
        constituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) }
    }
}

private func corrections(_ latitude: Double) throws -> Catalog {
    try Catalog.shared.corrected(with: .foreman(latitude: latitude), names: [])
}

// UTide's own f and u, written by packages/engine/scripts/gen-foreman.py. The two astronomies
// differ in their polynomials, which leaves about 1e-5 in f and 0.002° in u.
@Test func foremanCorrectionsMatchUtide() throws {
    let reference = try loadFixture("foreman-utide", as: [UtideEntry].self)
    for entry in reference {
        let catalog = try corrections(entry.latitude)
        let a = astro(parseISO(entry.time))
        for (name, expected) in entry.values {
            let got = catalog.correction(name, a)
            #expect(abs(got.f - expected[0]) < 1e-4, "\(name) f at \(entry.time), \(entry.latitude)")
            #expect(angularDiff(got.u, expected[1]) < 0.01, "\(name) u at \(entry.time), \(entry.latitude)")
        }
    }
}

@Test func foremanPredictionMatchesSlackwater() throws {
    let fixture = try loadFixture("prediction-foreman", as: ForemanFixture.self)
    let (start, end) = (parseISO(fixture.start), parseISO(fixture.end))
    for c in fixture.cases {
        let station = try Station(constituents: fixture.harmonics, nodeCorrections: .foreman(latitude: c.latitude))
        let heights = station.heights(from: start, to: end, step: fixture.step)
        #expect(heights.count == c.points.count)
        for (got, expected) in zip(heights, c.points) {
            #expect(got.time == parseISO(expected.time))
            #expect(abs(got.height - expected.height) < 1e-6, "height at \(expected.time), latitude \(c.latitude)")
        }
        let extremes = station.extremes(from: start, to: end)
        #expect(extremes.count == c.extremes.count)
        for (got, expected) in zip(extremes, c.extremes) {
            #expect((got.kind == .high ? "high" : "low") == expected.kind)
            #expect(abs(got.time.timeIntervalSince(parseISO(expected.time))) < 1)
            #expect(abs(got.height - expected.height) < 1e-6)
        }
    }
}

@Test func foremanPredictsCurrentsOnBothAxes() throws {
    let fixture = try loadFixture("prediction-foreman", as: ForemanFixture.self)
    let c = fixture.cases[0]
    let station = try CurrentStation(constituents: fixture.harmonics, floodDirection: 0, ebbDirection: 180,
                                     minorConstituents: fixture.harmonics, azimuth: 0,
                                     nodeCorrections: .foreman(latitude: c.latitude))
    let speeds = station.speeds(from: parseISO(fixture.start), to: parseISO(fixture.end), step: fixture.step)
    #expect(speeds.count == c.points.count)
    for (got, expected) in zip(speeds, c.points) {
        #expect(got.time == parseISO(expected.time))
        #expect(abs(got.speed - expected.height) < 1e-6)
        #expect(abs((got.magnitude ?? 0) - abs(got.speed) * 2.0.squareRoot()) < 1e-9)
    }
}

@Test func foremanHoldsTheLatitudeFiveDegreesFromTheEquator() throws {
    let a = astro(parseISO("2010-05-01T00:00:00Z"))
    func k1(_ latitude: Double) throws -> (f: Double, u: Double) { try corrections(latitude).correction("K1", a) }
    #expect(try k1(0) == k1(4))
    #expect(try k1(-1) == k1(-5))
    #expect(try k1(1) != k1(-1))
}

@Test func foremanLeavesLinesItDoesNotGiveUncorrected() throws {
    let a = astro(parseISO("2010-05-01T00:00:00Z"))
    let catalog = try corrections(60)
    for name in ["Sa", "Mf", "unknown"] { #expect(catalog.correction(name, a) == (1, 0), "\(name)") }
    // The catalog's M1 is the line t_tide calls NO1.
    #expect(catalog.correction("M1", a) == catalog.correction("NO1", a))
    // A caller's own H1 or H2 takes the line t_tide means by it.
    #expect(catalog.correction("H1", a) == catalog.correction("alpha2", a))
    #expect(catalog.correction("H2", a) == catalog.correction("M(KS)2", a))
}

@Test(arguments: [Double.nan, 91, -90.5])
func foremanRejectsAnInvalidLatitude(_ latitude: Double) {
    #expect(throws: NodeCorrectionsError.invalidLatitude) {
        try Station(constituents: [], nodeCorrections: .foreman(latitude: latitude))
    }
    #expect(throws: NodeCorrectionsError.invalidLatitude) {
        try CurrentStation(constituents: [], nodeCorrections: .foreman(latitude: latitude))
    }
}

@Test func foremanRefusesLinesTTideNamesDifferently() throws {
    let fixture = try loadFixture("prediction-foreman", as: ForemanFixture.self)
    for (name, line) in fixture.refused {
        let harmonics = [HarmonicConstituent(name: name, amplitude: 0.1, phase: 0)]
        #expect(throws: NodeCorrectionsError.notForemanLine(name, line: line)) {
            try Station(constituents: harmonics, nodeCorrections: .foreman(latitude: 60))
        }
        #expect(throws: NodeCorrectionsError.notForemanLine(name, line: line)) {
            try CurrentStation(constituents: [], minorConstituents: harmonics, nodeCorrections: .foreman(latitude: 60))
        }
        // IHO's corrections predict them as the catalog defines them.
        _ = try Station(constituents: harmonics, nodeCorrections: .iho)
    }
}

@Test func foremanPredictsACallersOwnDefinitionUnderARefusedName() throws {
    let t = parseISO("2024-03-10T00:00:00Z")
    let speed = try #require(Catalog.shared.speed("SA_KV"))
    let definitions = [ConstituentDefinition(name: "Sa", speed: speed, coefficients: [0, 0, 1, 0, 0, -1, 0])]
    let own = try Station(constituents: [HarmonicConstituent(name: "Sa", amplitude: 0.1, phase: 0)],
                          definitions: definitions, nodeCorrections: .foreman(latitude: 60))
    let kv = try Station(constituents: [HarmonicConstituent(name: "SA_KV", amplitude: 0.1, phase: 0)],
                         nodeCorrections: .foreman(latitude: 60))
    #expect(abs(own.heights(from: t, to: t)[0].height - kv.heights(from: t, to: t)[0].height) < 1e-12)
}
