#if canImport(Accelerate)
import Foundation
import Testing
@testable import SlackwaterKit

private struct FitFixture: Decodable {
    let basis: [String]
    let cases: [Case]
    struct Sample: Decodable { let t: Double; let v: Double }
    struct Constituent: Decodable { let name: String; let amplitude: Double; let phase: Double }
    struct Pair: Decodable { let constituents: [String]; let requiredDays: Double }
    struct Expected: Decodable {
        let offset: Double; let rms: Double
        let constituents: [Constituent]; let unseparable: [Pair]
    }
    struct Case: Decodable { let days: Int; let samples: [Sample]; let expected: Expected }
}

@Test func harmonicFitMatchesSharedSVDGolden() throws {
    let fixture = try loadFixture("harmonic-fit", as: FitFixture.self)
    struct Parity: Decodable {
        struct Case: Decodable { let days: Int; let expected: Expected }
        struct Expected: Decodable {
            let offset: Double; let rms: Double; let constituents: [FitFixture.Constituent]
        }
        let cases: [Case]
    }
    let parity = try loadFixture("harmonic-fit-parity", as: Parity.self)
    for entry in fixture.cases {
        let expected = try #require(parity.cases.first { $0.days == entry.days }).expected
        let result = try fit(samples: entry.samples.map {
            HarmonicSample(time: Date(timeIntervalSince1970: $0.t / 1000), value: $0.v)
        }, constituents: fixture.basis)
        #expect(abs(result.offset - expected.offset) < 1e-7)
        #expect(abs(result.rms - expected.rms) < 1e-7)
        #expect(result.constituents.count == expected.constituents.count)
        for (actual, expected) in zip(result.constituents, expected.constituents) {
            #expect(actual.name == expected.name)
            #expect(abs(actual.amplitude - expected.amplitude) < 1e-6)
            #expect(angularDiff(actual.phase, expected.phase) < 1e-3)
        }
        #expect(result.unseparable.count == entry.expected.unseparable.count)
        for expected in entry.expected.unseparable {
            #expect(result.unseparable.contains {
                $0.constituents == expected.constituents && $0.requiredDays == expected.requiredDays
            })
        }
    }
}

@Test func harmonicFitRecoversPerSampleAstronomyWithGaps() throws {
    let truth = [HarmonicConstituent(name: "M2", amplitude: 1.23456789, phase: 359.999),
                 HarmonicConstituent(name: "O1", amplitude: 0.3456789, phase: 0.001)]
    let catalog = Catalog.shared
    let samples = (0..<800).map { i in
        let time = Date(timeIntervalSince1970: 1_262_304_000 + Double(i / 2) * 37 * 3600)
        let state = astro(time)
        let value = truth.reduce(-2.3456789) { sum, c in
            let correction = catalog.correction(c.name, state)
            return sum + c.amplitude * correction.f * cos(
                (catalog.v0(c.name, state) + correction.u - c.phase) * Double.pi / 180)
        }
        return HarmonicSample(time: time, value: value)
    }
    let result = try fit(samples: samples, constituents: truth.map(\.name))
    #expect(abs(result.offset + 2.3456789) < 1e-10)
    #expect(result.rms < 1e-10)
    #expect(result.unseparable.isEmpty)
    for (actual, expected) in zip(result.constituents, truth) {
        #expect(abs(actual.amplitude - expected.amplitude) < 1e-10)
        #expect(angularDiff(actual.phase, expected.phase) < 1e-8)
    }
}

@Test func harmonicFitRejectsInvalidAndSingularInputs() throws {
    struct Invalid: Decodable {
        let samples: [FitFixture.Sample]; let names: [String]; let error: String
    }
    for entry in try loadFixture("harmonic-fit-invalid", as: [Invalid].self) {
        let samples = entry.samples.map { HarmonicSample(time: Date(timeIntervalSince1970: $0.t / 1000), value: $0.v) }
        let expected: HarmonicFitError
        switch entry.error {
        case "unknownConstituent": expected = .unknownConstituent(entry.names[0])
        case "duplicateConstituent": expected = .duplicateConstituent(entry.names[1])
        case "rankDeficient": expected = .rankDeficient
        default: expected = .invalidSamples
        }
        #expect(throws: expected) { try fit(samples: samples, constituents: entry.names) }
    }
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    let samples = (0..<100).map { HarmonicSample(time: start.addingTimeInterval(Double($0) * 3600), value: 2) }
    for invalid in [Double.nan, .infinity] {
        #expect(throws: HarmonicFitError.self) {
            try fit(samples: [HarmonicSample(time: start, value: invalid)] + samples.dropFirst(), constituents: [])
        }
        #expect(throws: HarmonicFitError.self) {
            try fit(samples: [HarmonicSample(time: Date(timeIntervalSince1970: invalid), value: 0)] + samples.dropFirst(), constituents: [])
        }
    }
    let mean = try fit(samples: samples, constituents: [])
    #expect(abs(mean.offset - 2) < 1e-12)
    #expect(mean.rms < 1e-12)
}

@Test func harmonicFitKeepsLargeResidualRMSFinite() throws {
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    let result = try fit(samples: [
        HarmonicSample(time: start, value: 4e307),
        HarmonicSample(time: start.addingTimeInterval(3600), value: 6e307),
    ], constituents: [])
    #expect(abs(result.rms / 1e307 - 1) < 1e-12)
}

@Test func harmonicFitKeepsLargeConstantOffsetFinite() throws {
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    let result = try fit(samples: [
        HarmonicSample(time: start, value: 5e307),
        HarmonicSample(time: start.addingTimeInterval(3600), value: 5e307),
    ], constituents: [])
    #expect(abs(result.offset / 5e307 - 1) < 1e-12)
}

@Test func harmonicFitPreservesTinyResidualRMS() throws {
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    let result = try fit(samples: [
        HarmonicSample(time: start, value: 4e-307),
        HarmonicSample(time: start.addingTimeInterval(3600), value: 6e-307),
    ], constituents: [])
    #expect(abs(result.rms / 1e-307 - 1) < 1e-12)
}

@Test func harmonicFitRejectsOverflowAfterRestoringScale() throws {
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    let samples = [-1e308, 1e308, -1e308].enumerated().map {
        HarmonicSample(time: start.addingTimeInterval(Double($0.offset) * 3600), value: $0.element)
    }
    #expect(throws: HarmonicFitError.rankDeficient) {
        try fit(samples: samples, constituents: ["M2"])
    }
}

@Test func harmonicFitPreservesRepeatedChunkBoundarySamples() throws {
    let fixture = try loadFixture("harmonic-fit", as: FitFixture.self)
    let samples = fixture.cases[0].samples.map {
        HarmonicSample(time: Date(timeIntervalSince1970: $0.t / 1000), value: $0.v)
    }
    let original = try fit(samples: samples, constituents: fixture.basis)
    let repeated = try fit(samples: samples.flatMap { [$0, $0] }, constituents: fixture.basis)
    #expect(abs(original.offset - repeated.offset) < 1e-10)
    #expect(abs(original.rms - repeated.rms) < 1e-10)
    for (a, b) in zip(original.constituents, repeated.constituents) {
        #expect(abs(a.amplitude - b.amplitude) < 1e-9)
        #expect(angularDiff(a.phase, b.phase) < 1e-6)
    }
}
#endif
