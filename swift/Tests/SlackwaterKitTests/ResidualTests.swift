import Foundation
import Testing
import SlackwaterKit

private let residualHour = 3600.0
private func hourlyResiduals(_ count: Int, offset: Double = 0, value: (Int) -> Double) -> [ResidualSample] {
    (0..<count).map { ResidualSample(time: Date(timeIntervalSince1970: offset + Double($0) * residualHour), value: value($0)) }
}

private struct ResidualFixture: Decodable {
    let cases: [Case]
    struct Sample: Decodable { let time: Double; let value: Double }
    struct Reading: Decodable { let time: Double; let observed: Double; let predicted: Double }
    struct Trend: Decodable { let time: Double; let slopePerHour: Double; let direction: String }
    struct Case: Decodable {
        let name: String; let samples: [Sample]; let readings: [Reading]?
        let filtered: [Sample]; let trend: Trend?
    }
}

@Test func residualPublicAPIAndSupport() throws {
    let readings = [WaterLevelReading(time: Date(timeIntervalSince1970: 0), observed: 1.4, predicted: 1.2),
                    WaterLevelReading(time: Date(timeIntervalSince1970: 1), observed: 0, predicted: 0),
                    WaterLevelReading(time: Date(timeIntervalSince1970: 2), observed: -2, predicted: 1)]
    let result = try residuals(readings: readings)
    #expect(abs(result[0].value - 0.2) < 1e-12)
    #expect(result[1].value == 0)
    #expect(result[2].value == -3)
    #expect(readings[0].observed == 1.4)
    #expect(try residuals(readings: []).isEmpty)
    #expect(try filterResiduals(samples: []).isEmpty)
    #expect(try filterResiduals(samples: hourlyResiduals(70) { _ in 0.15 }).isEmpty)
    let one = try filterResiduals(samples: hourlyResiduals(71) { _ in 0.15 })
    #expect(one.count == 1)
    #expect(one[0].time == Date(timeIntervalSince1970: 35 * residualHour))
    #expect(abs(one[0].value - 0.15) < 1e-12)
    let input = hourlyResiduals(97) { 0.1 + Double($0) * 0.002 }
    let filtered = try filterResiduals(samples: input)
    #expect(filtered.count == 27)
    #expect(filtered.last?.time == Date(timeIntervalSince1970: 61 * residualHour))
    let trend = try #require(try residualTrend(samples: filtered))
    #expect(abs(trend.slopePerHour - 0.002) < 1e-12)
    #expect(trend.direction == .rising)
    let publicTrend = ResidualTrend(time: trend.time, slopePerHour: trend.slopePerHour, direction: .rising)
    #expect(publicTrend.direction.rawValue == "rising")
    #expect(input[0].value == 0.1)
}

@Test func residualMatchesIndependentSharedOracle() throws {
    let fixture = try loadFixture("residuals-parity", as: ResidualFixture.self)
    for entry in fixture.cases {
        let samples = entry.samples.map { ResidualSample(time: Date(timeIntervalSince1970: $0.time / 1000), value: $0.value) }
        if let readings = entry.readings {
            let actual = try residuals(readings: readings.map { WaterLevelReading(time: Date(timeIntervalSince1970: $0.time / 1000), observed: $0.observed, predicted: $0.predicted) })
            #expect(actual.count == samples.count)
            for (actual, expected) in zip(actual, samples) {
                #expect(actual.time == expected.time)
                #expect(abs(actual.value - expected.value) < 1e-9)
            }
        }
        let actual = try filterResiduals(samples: samples)
        #expect(actual.count == entry.filtered.count, "\(entry.name)")
        for (actual, expected) in zip(actual, entry.filtered) {
            #expect(actual.time == Date(timeIntervalSince1970: expected.time / 1000))
            #expect(abs(actual.value - expected.value) < 1e-9)
        }
        let trend = try residualTrend(samples: actual)
        if let expected = entry.trend {
            let trend = try #require(trend)
            #expect(trend.time == Date(timeIntervalSince1970: expected.time / 1000))
            #expect(abs(trend.slopePerHour - expected.slopePerHour) < 1e-10)
            #expect(trend.direction.rawValue == expected.direction)
        } else {
            #expect(trend == nil)
        }
    }
}

@Test func residualRetainsGridOffsetsAndSplitsGaps() throws {
    for offset in [1800.0, 0.123, parseISO("2025-11-02T07:30:00Z").timeIntervalSince1970] {
        let filtered = try filterResiduals(samples: hourlyResiduals(97, offset: offset) { _ in 1 })
        #expect(filtered[0].time == Date(timeIntervalSince1970: offset + 35 * residualHour))
        #expect(filtered.last?.time == Date(timeIntervalSince1970: offset + 61 * residualHour))
        #expect(try residualTrend(samples: filtered)?.time == filtered.last?.time)
    }
    let split = hourlyResiduals(145) { _ in 1 }.enumerated().filter { $0.offset != 72 }.map(\.element)
    let output = try filterResiduals(samples: split)
    #expect(output.map(\.time) == [35, 36, 108, 109].map { Date(timeIntervalSince1970: Double($0) * residualHour) })
    let trailing = hourlyResiduals(97) { _ in 1 }.enumerated().filter { $0.offset != 95 }.map(\.element)
    #expect(try filterResiduals(samples: trailing).count == 25)
    #expect(try residualTrend(samples: []) == nil)
    #expect(try residualTrend(samples: hourlyResiduals(24) { _ in 0 }) == nil)
    let newestGap = hourlyResiduals(26) { _ in 0 }.enumerated().filter { $0.offset != 24 }.map(\.element)
    #expect(try residualTrend(samples: newestGap) == nil)
    let oldGap = hourlyResiduals(50) { Double($0) * -0.002 }.enumerated().filter { $0.offset != 24 }.map(\.element)
    #expect(try residualTrend(samples: oldGap)?.direction == .falling)
}

@Test func residualTrendBoundariesAndLargeOffset() throws {
    let cases: [(Double, ResidualTrend.Direction)] = [
        (0, .steady), (0.002, .rising), (-0.002, .falling),
        (0.01 / 24, .steady), (-0.01 / 24, .steady),
        ((0.01 + 0.5e-12) / 24, .steady), (-(0.01 + 0.5e-12) / 24, .steady),
        ((0.01 + 2e-12) / 24, .rising), (-(0.01 + 2e-12) / 24, .falling),
    ]
    for (slope, direction) in cases {
        let trend = try #require(try residualTrend(samples: hourlyResiduals(25) { Double($0) * slope }))
        #expect(abs(trend.slopePerHour - slope) < 1e-12)
        #expect(trend.direction == direction)
    }
    let input = hourlyResiduals(25) { 1e6 + Double($0) * 0.002 }
    #expect(abs(try #require(try residualTrend(samples: input)).slopePerHour - 0.002) < 1e-10)
    #expect(input[0].value == 1e6)
}

@Test func residualRejectsCadenceHiddenByUnixEpochRounding() throws {
    let start = Date(timeIntervalSinceReferenceDate: pow(2, 29) - 48 * residualHour + 0.12300006)
    let samples = (0..<97).map {
        ResidualSample(time: start.addingTimeInterval(Double($0) * residualHour), value: 0.15)
    }
    #expect(throws: ResidualError.invalidCadence) { try filterResiduals(samples: samples) }
    #expect(throws: ResidualError.invalidCadence) { try residualTrend(samples: samples) }
}

@Test func residualRejectsInvalidSamplesCadenceAndOverflow() throws {
    let zero = Date(timeIntervalSince1970: 0)
    for invalid in [Double.nan, .infinity, -.infinity] {
        #expect(throws: ResidualError.invalidSamples) {
            try residuals(readings: [WaterLevelReading(time: zero, observed: invalid, predicted: 0)])
        }
        #expect(throws: ResidualError.invalidSamples) {
            try residuals(readings: [WaterLevelReading(time: zero, observed: 0, predicted: invalid)])
        }
        #expect(throws: ResidualError.invalidSamples) {
            try residuals(readings: [WaterLevelReading(time: Date(timeIntervalSince1970: invalid), observed: 0, predicted: 0)])
        }
        for samples in [[ResidualSample(time: zero, value: invalid)], [ResidualSample(time: Date(timeIntervalSince1970: invalid), value: 0)]] {
            #expect(throws: ResidualError.invalidSamples) { try filterResiduals(samples: samples) }
            #expect(throws: ResidualError.invalidSamples) { try residualTrend(samples: samples) }
        }
    }
    for second in [0.0, -residualHour] {
        let times = [zero, Date(timeIntervalSince1970: second)]
        #expect(throws: ResidualError.invalidSamples) { try residuals(readings: times.map { WaterLevelReading(time: $0, observed: 0, predicted: 0) }) }
        let samples = times.map { ResidualSample(time: $0, value: 0) }
        #expect(throws: ResidualError.invalidSamples) { try filterResiduals(samples: samples) }
        #expect(throws: ResidualError.invalidSamples) { try residualTrend(samples: samples) }
    }
    for second in [residualHour / 10, residualHour + 0.001, 2 * residualHour + 0.001] {
        let samples = [ResidualSample(time: zero, value: 0), ResidualSample(time: Date(timeIntervalSince1970: second), value: 0)]
        #expect(throws: ResidualError.invalidCadence) { try filterResiduals(samples: samples) }
        #expect(throws: ResidualError.invalidCadence) { try residualTrend(samples: samples) }
    }
    #expect(throws: ResidualError.nonFiniteResult) { try residuals(readings: [WaterLevelReading(time: zero, observed: .greatestFiniteMagnitude, predicted: -.greatestFiniteMagnitude)]) }
    #expect(throws: ResidualError.nonFiniteResult) { try filterResiduals(samples: hourlyResiduals(71) { _ in .greatestFiniteMagnitude }) }
    #expect(throws: ResidualError.nonFiniteResult) { try residualTrend(samples: hourlyResiduals(25) { $0 < 12 ? -.greatestFiniteMagnitude : .greatestFiniteMagnitude }) }
}
