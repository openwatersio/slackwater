// Slackwater — MIT. Subordinate tide stations.
import Foundation

/// A subordinate tide station: no constituents of its own. NOAA publishes time
/// corrections and a height correction against a reference station's highs and
/// lows; the curve between two corrected extremes is a half-cosine, which is how
/// NOAA draws it too. Accuracy is a different class from a harmonic station's.
public struct SubordinateTideStation: Sendable {
    public enum HeightOffset: Sendable {
        /// Multiply the reference height above chart datum.
        case ratio(high: Double, low: Double)
        /// Add metres to the reference height.
        case fixed(high: Double, low: Double)
    }

    let reference: Station
    public let highTimeOffset: TimeInterval
    public let lowTimeOffset: TimeInterval
    public let height: HeightOffset

    public init(reference: Station, highTimeOffset: TimeInterval, lowTimeOffset: TimeInterval, height: HeightOffset) {
        self.reference = reference
        self.highTimeOffset = highTimeOffset
        self.lowTimeOffset = lowTimeOffset
        self.height = height
    }

    /// The reference's extremes, time-shifted and height-corrected. Sorted, because
    /// unequal high/low offsets can reorder neighbours.
    public func extremes(from: Date, to: Date) -> [TideExtreme] {
        extremes(from: from, to: to, prominenceThreshold: 0.01)
    }

    private func extremes(from: Date, to: Date, prominenceThreshold: Double) -> [TideExtreme] {
        let pad = max(abs(highTimeOffset), abs(lowTimeOffset)) + 3600
        return reference.extremes(from: from.addingTimeInterval(-pad), to: to.addingTimeInterval(pad),
                                  prominenceThreshold: prominenceThreshold)
            .map(correct)
            .filter { $0.time >= from && $0.time <= to }
            .sorted { $0.time < $1.time }
    }

    private func correct(_ e: TideExtreme) -> TideExtreme {
        let isHigh = e.kind == .high
        let time = e.time.addingTimeInterval(isHigh ? highTimeOffset : lowTimeOffset)
        let h: Double
        switch height {
        case .ratio(let high, let low): h = e.height * (isHigh ? high : low)
        case .fixed(let high, let low): h = e.height + (isHigh ? high : low)
        }
        return TideExtreme(time: time, height: h, kind: e.kind)
    }

    /// Height series (metres) on the same floored/ceiled timeline as `Station.heights`.
    public func heights(from: Date, to: Date, step: TimeInterval = 600) -> [TidePoint] {
        curve(from: from, to: to, step: step).map { TidePoint(time: $0.time, height: $0.height) }
    }

    /// dh/dt (metres/hour) on the same timeline as `heights`.
    public func rates(from: Date, to: Date, step: TimeInterval = 600) -> [TideRatePoint] {
        curve(from: from, to: to, step: step).map { TideRatePoint(time: $0.time, rate: $0.rate) }
    }

    private func curve(from: Date, to: Date, step: TimeInterval) -> [(time: Date, height: Double, rate: Double)] {
        let pad = 15.0 * 3600  // longer than any gap between neighbouring extremes
        var ex = extremes(from: from.addingTimeInterval(-pad), to: to.addingTimeInterval(pad))
        // A tide whose every turn is below the threshold still needs knots; use its raw turning points.
        if ex.count < 2 {
            ex = extremes(from: from.addingTimeInterval(-pad), to: to.addingTimeInterval(pad), prominenceThreshold: 0)
        }
        return halfCosineCurve(through: ex.map { ($0.time, $0.height) },
                               on: makeTimeline(from: from, to: to, step: step).items)
            .map { (time: $0.time, height: $0.value, rate: $0.rate) }
    }
}

/// Half-cosine between each pair of neighbouring knots: v(t) = mid + half·cos(π·u),
/// u = (t − t₁)/(t₂ − t₁). It is how NOAA draws a subordinate's curve too. Outside
/// the bracketed span (only if a caller's pad is ever too short) the nearest
/// knot's value holds flat. `rate` is dv/dt per hour, zero where clamped.
func halfCosineCurve(through knots: [(time: Date, value: Double)], on items: [Date])
    -> [(time: Date, value: Double, rate: Double)] {
    guard knots.count >= 2 else { return items.map { ($0, knots.first?.value ?? 0, 0) } }
    var i = 0
    return items.map { t in
        let s = t.timeIntervalSince1970
        while i + 2 < knots.count && knots[i + 1].time.timeIntervalSince1970 <= s { i += 1 }
        let t1 = knots[i].time.timeIntervalSince1970, t2 = knots[i + 1].time.timeIntervalSince1970
        let v1 = knots[i].value, v2 = knots[i + 1].value
        let u = min(1, max(0, (s - t1) / (t2 - t1)))
        let mid = (v1 + v2) / 2, half = (v1 - v2) / 2
        let clamped = s < t1 || s > t2
        return (t, mid + half * cos(.pi * u),
                clamped ? 0 : -half * .pi / (t2 - t1) * sin(.pi * u) * 3600)
    }
}
