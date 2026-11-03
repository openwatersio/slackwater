import Foundation
import Testing
@testable import SlackwaterKit

private struct VectorFixture: Decodable {
    let start: String; let end: String; let timeFidelity: Double
    let constituents: [C]; let minorConstituents: [C]
    let meanFlow: Double; let minorMeanFlow: Double
    let floodDirection: Double; let ebbDirection: Double; let azimuth: Double
    let timeline: [P]
    struct C: Decodable {
        let name: String; let amplitude: Double; let phase: Double
        var harmonic: HarmonicConstituent { HarmonicConstituent(name: name, amplitude: amplitude, phase: phase) }
    }
    struct P: Decodable { let time: String; let speed: Double; let magnitude: Double; let direction: Double }
}

@Test func currentVectorMatchesSharedFixture() throws {
    let f = try loadFixture("currents-vector", as: VectorFixture.self)
    let station = CurrentStation(constituents: f.constituents.map(\.harmonic),
        floodDirection: f.floodDirection, ebbDirection: f.ebbDirection, offset: f.meanFlow,
        minorConstituents: f.minorConstituents.map(\.harmonic), minorMeanFlow: f.minorMeanFlow, azimuth: f.azimuth)
    let _: Double = station.floodDirection
    let _: Double = station.ebbDirection
    let from = parseISO(f.start), to = parseISO(f.end)
    let points = station.speeds(from: from, to: to, step: f.timeFidelity)
    #expect(points.count == f.timeline.count)
    for (point, expected) in zip(points, f.timeline) {
        #expect(abs(point.time.timeIntervalSince(parseISO(expected.time))) < 0.001)
        #expect(abs(point.speed - expected.speed) < 1e-6)
        #expect(abs(point.magnitude - expected.magnitude) < 1e-6)
        #expect(angularDiff(try #require(point.direction), expected.direction) < 1e-5)
    }
    let axial = CurrentStation(constituents: f.constituents.map(\.harmonic),
        floodDirection: f.floodDirection, ebbDirection: f.ebbDirection, offset: f.meanFlow)
    let actual = station.events(from: from, to: to), expected = axial.events(from: from, to: to)
    #expect(actual.count == expected.count)
    for (a, b) in zip(actual, expected) { #expect(a.time == b.time && a.speed == b.speed && a.kind == b.kind) }
}

@Test func currentVectorAnalyticBearingsAndFallbacks() throws {
    let from = parseISO("2026-01-01T00:00:00Z"), to = parseISO("2026-01-02T00:00:00Z")
    for (u, v, azi, expected) in [(3.0, 4.0, 0.0, 53.13010235415598), (-3, 4, 0, 126.86989764584402),
        (-3, -4, 0, 233.13010235415598), (3, -4, 0, 306.86989764584405), (0, 4, -90, 0), (0, -4, 450, 0)] {
        let s = CurrentStation(constituents: [], floodDirection: 30, ebbDirection: 225, offset: u,
            minorMeanFlow: v, azimuth: azi)
        let p = try #require(s.speeds(from: from, to: to).first)
        #expect(p.speed == u)
        #expect(abs(p.magnitude - (u == 0 ? 4 : 5)) < 1e-10)
        #expect(angularDiff(try #require(p.direction), expected) < 1e-10)
    }
    for (speed, expected) in [(2.0, 30.0), (-2, 225)] {
        let p = try #require(CurrentStation(constituents: [], floodDirection: 30, ebbDirection: 225, offset: speed).speeds(from: from, to: to).first)
        #expect(p.magnitude == 2)
        #expect(p.direction == expected)
    }
    let zero = try #require(CurrentStation(constituents: [], floodDirection: 30, ebbDirection: 225, minorConstituents: []).speeds(from: from, to: to).first)
    #expect(zero.magnitude == 0 && zero.direction == nil)
    let defaultAxis = try #require(CurrentStation(constituents: [], floodDirection: 30, ebbDirection: 225,
        offset: -2, minorConstituents: []).speeds(from: from, to: to).first)
    #expect(defaultAxis.direction == 225)
    for minor in [[HarmonicConstituent(name: "UNKNOWN", amplitude: 1, phase: 0)],
                  [HarmonicConstituent(name: "M2", amplitude: 0, phase: 0)]] {
        let p = try #require(CurrentStation(constituents: [], floodDirection: 30, ebbDirection: 225,
            offset: -2, minorConstituents: minor).speeds(from: from, to: to).first)
        #expect(p.direction == 225)
    }
    let synthesized = CurrentPoint(time: from, speed: -3)
    #expect(synthesized.magnitude == 3 && synthesized.direction == nil)
}

@Test func currentVectorsPreserveUnknownSwiftBearings() throws {
    let from = parseISO("2026-01-01T00:00:00Z"), to = from.addingTimeInterval(86400)
    for s in [CurrentStation(constituents: [], offset: 3),
              CurrentStation(constituents: [], floodDirection: 20, offset: -3),
              CurrentStation(constituents: [], offset: 3, minorMeanFlow: 4),
              CurrentStation(constituents: [], floodDirection: .nan, offset: 3),
              CurrentStation(constituents: [], floodDirection: 20, ebbDirection: 200, offset: .nan)] {
        #expect(try #require(s.speeds(from: from, to: to).first).direction == nil)
    }
    let ref = CurrentStation(constituents: [HarmonicConstituent(name: "S2", amplitude: 2, phase: 0)])
    let sub = SubordinateStation(reference: ref, slackBeforeFloodOffset: 0, slackBeforeEbbOffset: 0,
        floodTimeOffset: 0, ebbTimeOffset: 0, floodSpeedRatio: 1, ebbSpeedRatio: 1, floodDirection: 10)
    let points = sub.speeds(from: from, to: to)
    #expect(points.contains { $0.speed < 0 })
    #expect(points.filter { $0.speed < 0 }.allSatisfy { $0.direction == nil })
    #expect(points.filter { $0.speed > 0 }.allSatisfy { $0.direction == 10 })
}

@Test func subordinateCurrentVectorsUseOwnDirections() {
    let from = parseISO("2026-01-01T00:00:00Z"), to = parseISO("2026-01-02T00:00:00Z")
    let ref = CurrentStation(constituents: [HarmonicConstituent(name: "S2", amplitude: 2, phase: 0)],
        floodDirection: 10, ebbDirection: 190, minorMeanFlow: 1)
    let sub = SubordinateStation(reference: ref, slackBeforeFloodOffset: 0, slackBeforeEbbOffset: 0,
        floodTimeOffset: 0, ebbTimeOffset: 0, floodSpeedRatio: 1, ebbSpeedRatio: 1,
        floodDirection: 30, ebbDirection: 225)
    let _: Double = sub.floodDirection
    let _: Double = sub.ebbDirection
    for p in sub.speeds(from: from, to: to) {
        #expect(p.magnitude == abs(p.speed))
        #expect(p.direction == (p.speed > 0 ? 30 : p.speed < 0 ? 225 : nil))
    }
}
