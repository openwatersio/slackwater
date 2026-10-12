import Foundation

public struct WaterLevelReading: Sendable {
    public let time: Date
    public let observed: Double
    public let predicted: Double
    public init(time: Date, observed: Double, predicted: Double) {
        self.time = time; self.observed = observed; self.predicted = predicted
    }
}

public struct ResidualSample: Sendable {
    public let time: Date
    public let value: Double
    public init(time: Date, value: Double) { self.time = time; self.value = value }
}

public struct ResidualTrend: Sendable {
    public let time: Date
    public let slopePerHour: Double
    public let direction: Direction
    public enum Direction: String, Sendable {
        case rising, steady, falling
    }
    public init(time: Date, slopePerHour: Double, direction: Direction) {
        self.time = time; self.slopePerHour = slopePerHour; self.direction = direction
    }
}

public enum ResidualError: Error, Equatable, Sendable {
    case invalidSamples
    case invalidCadence
    case nonFiniteResult
}

private let residualHour = 3600.0

private func validateResidualTime(_ time: Date, previous: Double) throws -> Double {
    let instant = time.timeIntervalSince1970
    guard instant.isFinite, instant > previous else { throw ResidualError.invalidSamples }
    return instant
}

private func finiteResidualResult(_ value: Double) throws -> Double {
    guard value.isFinite else { throw ResidualError.nonFiniteResult }
    return value
}

private func validateHourlyResiduals(_ samples: [ResidualSample]) throws {
    var previous = -Double.infinity
    for sample in samples {
        let instant = try validateResidualTime(sample.time, previous: previous)
        guard sample.value.isFinite else { throw ResidualError.invalidSamples }
        if previous != -Double.infinity && (instant - previous).truncatingRemainder(dividingBy: residualHour) != 0 {
            throw ResidualError.invalidCadence
        }
        previous = instant
    }
}

public func residuals(readings: [WaterLevelReading]) throws -> [ResidualSample] {
    var previous = -Double.infinity
    return try readings.map { reading in
        previous = try validateResidualTime(reading.time, previous: previous)
        guard reading.observed.isFinite, reading.predicted.isFinite else { throw ResidualError.invalidSamples }
        return ResidualSample(time: reading.time, value: try finiteResidualResult(reading.observed - reading.predicted))
    }
}

private func residualMovingMean(_ values: [Double], width: Int) throws -> [Double] {
    try (0...(values.count - width)).map { i in
        var sum = 0.0
        for j in 0..<width { sum += values[i + j] }
        return try finiteResidualResult(sum / Double(width))
    }
}

public func filterResiduals(samples: [ResidualSample]) throws -> [ResidualSample] {
    try validateHourlyResiduals(samples)
    var output: [ResidualSample] = []
    var start = 0
    var end = 1
    while end <= samples.count {
        if end == samples.count || samples[end].time.timeIntervalSince(samples[end - 1].time) != residualHour {
            if end - start >= 71 {
                var values = samples[start..<end].map(\.value)
                for width in [24, 24, 25] { values = try residualMovingMean(values, width: width) }
                for (i, value) in values.enumerated() {
                    output.append(ResidualSample(time: samples[start + i + 35].time, value: value))
                }
            }
            start = end
        }
        end += 1
    }
    return output
}

public func residualTrend(samples: [ResidualSample]) throws -> ResidualTrend? {
    try validateHourlyResiduals(samples)
    guard samples.count >= 25 else { return nil }
    let window = Array(samples.suffix(25))
    guard window[24].time.timeIntervalSince(window[0].time) == 24 * residualHour else { return nil }
    // Subtract a nearby baseline before multiplying to retain small slopes on large offsets.
    let baseline = window[12].value
    var covariance = 0.0
    for i in 0..<25 { covariance += Double(i - 12) * (window[i].value - baseline) }
    // Centered hourly indices -12...12 have squared sum 1300.
    let slopePerHour = try finiteResidualResult(covariance / 1300)
    let change = try finiteResidualResult(slopePerHour * 24)
    let direction: ResidualTrend.Direction = abs(change) <= 0.01 + 1e-12 ? .steady : change > 0 ? .rising : .falling
    return ResidualTrend(time: window[24].time, slopePerHour: slopePerHour, direction: direction)
}
