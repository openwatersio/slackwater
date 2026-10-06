import Foundation
import Testing
@testable import SlackwaterKit

private struct SubordinateFixture: Decodable {
    let start: String
    let end: String
    let cases: [Case]
    struct Case: Decodable {
        let station: String
        let name: String
        let offset: Double
        let constituents: [C]
        let offsets: Offsets
        let official: [E]
    }
    struct C: Decodable { let name: String; let amplitude: Double; let phase: Double }
    struct E: Decodable { let time: String; let height: Double; let kind: String }
    struct Offsets: Decodable {
        let height: Height
        let time: Time
        struct Height: Decodable { let type: String; let high: Double; let low: Double }
        struct Time: Decodable { let high: Double; let low: Double }
    }
}

private func build(_ c: SubordinateFixture.Case) -> SubordinateTideStation {
    let ref = Station(
        constituents: c.constituents.map { HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase) },
        offset: c.offset)
    let h = c.offsets.height
    return SubordinateTideStation(
        reference: ref,
        highTimeOffset: c.offsets.time.high * 60, lowTimeOffset: c.offsets.time.low * 60,
        height: h.type == "ratio" ? .ratio(high: h.high, low: h.low) : .fixed(high: h.high, low: h.low))
}

/// Reproduce NOAA's OWN hi/lo for two subordinate stations — one ratio, one fixed —
/// from the reference's constituents plus the subordinate's offsets. Same real-world
/// tolerances as Friday Harbor: ±15 min, ±0.15 m.
@Test func subordinatesMatchNOAA() throws {
    let fx = try loadFixture("realworld-subordinates", as: SubordinateFixture.self)
    for c in fx.cases {
        let sub = build(c)
        let computed = sub.extremes(from: parseISO(fx.start).addingTimeInterval(-3600),
                                    to: parseISO(fx.end).addingTimeInterval(3600))
        #expect(!computed.isEmpty, "\(c.name)")
        var maxTimeErr = 0.0, maxHeightErr = 0.0
        for off in c.official {
            let t = parseISO(off.time)
            let kind: ExtremeKind = off.kind == "high" ? .high : .low
            let match = computed.filter { $0.kind == kind }
                .min { abs($0.time.timeIntervalSince1970 - t.timeIntervalSince1970) < abs($1.time.timeIntervalSince1970 - t.timeIntervalSince1970) }
            let m = try #require(match, "\(c.name): no computed \(off.kind) near \(off.time)")
            let timeErr = abs(m.time.timeIntervalSince1970 - t.timeIntervalSince1970) / 60
            let heightErr = abs(m.height - off.height)
            maxTimeErr = max(maxTimeErr, timeErr)
            maxHeightErr = max(maxHeightErr, heightErr)
            #expect(timeErr < 15, "\(c.name) \(off.kind) at \(off.time): time off by \(timeErr) min")
            #expect(heightErr < 0.15, "\(c.name) \(off.kind) at \(off.time): height \(m.height) vs official \(off.height)")
        }
        print("\(c.name) vs NOAA — max time error \(String(format: "%.1f", maxTimeErr)) min, max height error \(String(format: "%.3f", maxHeightErr)) m")
    }
}

/// A reference whose every turn is under the prominence threshold still draws its
/// own curve through identity offsets.
@Test func subordinateCurveFollowsATideWithNoTurnAboveTheThreshold() {
    let ref = Station(constituents: [HarmonicConstituent(name: "M2", amplitude: 0.004, phase: 20)])
    let sub = SubordinateTideStation(reference: ref, highTimeOffset: 0, lowTimeOffset: 0,
                                     height: .ratio(high: 1, low: 1))
    let from = parseISO("2025-01-01T00:00:00Z"), to = parseISO("2025-01-01T04:00:00Z")
    let subHeights = sub.heights(from: from, to: to), refHeights = ref.heights(from: from, to: to)
    #expect(subHeights.count == refHeights.count)
    for (s, r) in zip(subHeights, refHeights) {
        #expect(abs(s.height - r.height) < 1e-5, "height at \(r.time): \(s.height) vs \(r.height)")
    }
}

/// The curve passes through every shifted extreme and moves monotonically between
/// neighbours, and the rate series shares its timeline and sign with the curve.
@Test func subordinateCurveInterpolatesBetweenExtremes() throws {
    let fx = try loadFixture("realworld-subordinates", as: SubordinateFixture.self)
    let sub = build(fx.cases[0])
    let from = parseISO(fx.start), to = parseISO(fx.end)
    let extremes = sub.extremes(from: from, to: to)
    let heights = sub.heights(from: from, to: to, step: 60)
    let rates = sub.rates(from: from, to: to, step: 60)
    #expect(heights.count == rates.count)
    for (e, next) in zip(extremes, extremes.dropFirst()) {
        let at = heights.min { abs($0.time.timeIntervalSince1970 - e.time.timeIntervalSince1970) < abs($1.time.timeIntervalSince1970 - e.time.timeIntervalSince1970) }!
        #expect(abs(at.height - e.height) < 0.01, "curve misses \(e.kind) at \(e.time)")
        let between = zip(heights, rates).filter { $0.0.time > e.time && $0.0.time < next.time }
        let rising = e.kind == .low
        for (h, i) in between.enumerated().dropFirst() {
            let prev = between[h - 1].0.height
            #expect(rising ? i.0.height >= prev : i.0.height <= prev, "not monotone at \(i.0.time)")
            #expect(rising ? i.1.rate >= 0 : i.1.rate <= 0, "rate sign at \(i.1.time)")
        }
    }
}
