import Foundation
import Testing
@testable import SlackwaterKit

private struct NodeCorrFixture: Decodable {
    let entries: [Entry]
    struct Entry: Decodable { let time: String; let corrections: [String: FU] }
    struct FU: Decodable { let f: Double; let u: Double }
}

@Test func nodeCorrectionsMatchSlackwater() throws {
    let fixture = try loadFixture("node-corrections", as: NodeCorrFixture.self)
    for entry in fixture.entries {
        let a = astro(parseISO(entry.time))
        for (name, expected) in entry.corrections {
            let i = try #require(Catalog.shared.index[name], "\(name): not in the catalog")
            let got = try #require(ihoCorrection(name, a, perigeeTurns: Catalog.shared.perigeeTurns[i]), "\(name): no IHO correction implemented")
            #expect(abs(got.f - expected.f) < 1e-6, "\(name) f at \(entry.time): got \(got.f), want \(expected.f)")
            #expect(angularDiff(got.u, expected.u) < 1e-6, "\(name) u at \(entry.time): got \(got.u), want \(expected.u)")
        }
    }
}


private struct SchuremanFixture: Decodable {
    let constituents: [Constituent]
    let definitions: [Definition]
    let points: [Point]
    struct Constituent: Decodable { let name: String; let amplitude: Double; let phase: Double }
    struct Definition: Decodable {
        let name: String; let speed: Double; let coefficients: [Int]; let members: [Member]
        struct Member: Decodable { let name: String; let factor: Double }
    }
    struct Point: Decodable { let time: String; let height: Double }
}

@Test func schuremanPredictsTidesAndCurrentsLikeSlackwater() throws {
    let fixture = try loadFixture("prediction-schureman", as: SchuremanFixture.self)
    let constituents = fixture.constituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) }
    let definitions = fixture.definitions.map { line in
        ConstituentDefinition(name: line.name, speed: line.speed, coefficients: line.coefficients,
                              members: line.members.map { .init(name: $0.name, factor: $0.factor) })
    }
    let tide = try Station(constituents: constituents, definitions: definitions, nodeCorrections: .schureman)
    let current = try CurrentStation(constituents: constituents, floodDirection: 0, ebbDirection: 180,
                                     minorConstituents: constituents, azimuth: 0,
                                     definitions: definitions, nodeCorrections: .schureman)
    for point in fixture.points {
        let time = parseISO(point.time)
        let height = tide.heights(from: time, to: time, step: 1)[0].height
        let flow = current.speeds(from: time, to: time, step: 1)[0]
        #expect(abs(height - point.height) < 1e-6, "tide at \(point.time)")
        #expect(abs(flow.speed - point.height) < 1e-6, "major axis at \(point.time)")
        #expect(abs(flow.magnitude - abs(point.height) * 2.0.squareRoot()) < 1e-6, "both axes at \(point.time)")
    }
}


private struct SchuremanEquations: Decodable {
    let astronomy: Angles
    let corrections: [String: NodeCorrFixture.FU]
    struct Angles: Decodable { let i, I, omega, nu, nup, nupp, P, p, xi: Double }
}

@Test func schuremanFundamentalsMatchEquationValues() throws {
    let fixture = try loadFixture("schureman-equations", as: SchuremanEquations.self)
    let angles = fixture.astronomy
    let a = Astro(s: 0, h: 0, p: angles.p, N: 0, pp: 0, ninety: 90, omega: angles.omega, i: angles.i,
                  I: angles.I, xi: angles.xi, nu: angles.nu, nup: angles.nup, nupp: angles.nupp, ThMinusS: 0, P: angles.P)
    let catalog = try Catalog.shared.corrected(with: .schureman, names: [])
    for (name, expected) in fixture.corrections {
        let correction = catalog.correction(name, a)
        #expect(abs(correction.f - expected.f) < 1e-6, "\(name) amplitude factor")
        #expect(angularDiff(correction.u, expected.u) < 1e-6, "\(name) phase correction")
    }
    let m1 = try #require(fixture.corrections["M1"])
    let withoutPerigee = try #require(schuremanCorrection("M1", a, perigeeTurns: 0))
    #expect(angularDiff(withoutPerigee.u, m1.u + angles.p) < 1e-6)
}
