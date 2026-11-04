// Slackwater — MIT. What the tide is doing at an instant, read from a sampled
// height series and its highs and lows. Mirrors packages/engine/src/readings/tide.ts.
import Foundation

/// The phase of the tide a reading falls in.
public enum TideState: Sendable, Equatable { case high, low, rising, falling }

/// The lead reading at an instant: phase, height, direction and rate.
public struct TideReading: Sendable, Equatable {
    public let state: TideState
    /// Height in the series' units.
    public let height: Double
    /// High or rising, rather than low or falling.
    public let rising: Bool
    /// Signed metres per hour: positive rising.
    public let rate: Double
    public init(state: TideState, height: Double, rising: Bool, rate: Double) {
        self.state = state; self.height = height; self.rising = rising; self.rate = rate
    }
}

extension Array where Element == TidePoint {
    /// Height at `time`, linearly interpolated; nil outside the series.
    public func height(at time: Date) -> Double? { interpolate(self, at: time, \.time, \.height) }

    /// The rate of rise at each sample in metres per hour, by central differences, one-sided at the ends.
    /// Sampled from the series, where `Station.rates(from:to:step:)` is the analytic derivative.
    public func rates() -> [TideRatePoint] {
        indices.map { i in
            let a = self[Swift.max(0, i - 1)], b = self[Swift.min(count - 1, i + 1)]
            let hours = b.time.timeIntervalSince(a.time) / 3600
            return TideRatePoint(time: self[i].time, rate: hours > 0 ? (b.height - a.height) / hours : 0)
        }
    }

    /// The lowest and highest sample in `from...to`; nil when none falls inside it.
    public func range(from: Date, to: Date) -> (min: Double, max: Double)? {
        var low = Double.infinity, high = -Double.infinity
        for p in self where p.time >= from && p.time <= to {
            if p.height < low { low = p.height }
            if p.height > high { high = p.height }
        }
        return low <= high ? (low, high) : nil
    }
}

extension Array where Element == TideRatePoint {
    /// Signed rate of rise at `time`, linearly interpolated; nil outside the samples.
    public func rate(at time: Date) -> Double? { interpolate(self, at: time, \.time, \.rate) }
}

/// Each rising or falling run's fastest sample, when it reaches `floor` metres per hour; a still sample ends a run.
public func flowPeaks(_ rates: [TideRatePoint], floor: Double) -> [TideRatePoint] {
    var peaks: [TideRatePoint] = []
    var run: [TideRatePoint] = []
    var direction = 0.0
    func finish() {
        var peak: TideRatePoint?
        for p in run where peak.map({ abs(p.rate) > abs($0.rate) }) ?? true { peak = p }
        if let peak, abs(peak.rate) >= floor { peaks.append(peak) }
        run = []
    }
    for p in rates {
        if abs(p.rate) < 0.0001 {
            finish()
            direction = 0
            continue
        }
        let next: Double = p.rate > 0 ? 1 : -1
        if direction != 0 && next != direction { finish() }
        direction = next
        run.append(p)
    }
    finish()
    return peaks
}

/// The lead reading at `time`: high or low within a second of a turn, at the turn's own height; otherwise rising
/// toward a high or falling toward a low, by the sampled rate when no later turn is loaded. Nil outside the samples.
public func readTide(at time: Date, heights: [TidePoint], rates: [TideRatePoint],
                     extremes: [TideExtreme]) -> TideReading? {
    guard let height = heights.height(at: time), let rate = rates.rate(at: time) else { return nil }
    if let turn = extremes.first(where: { withinOneSecond($0.time, time) }) {
        let high = turn.kind == .high
        return TideReading(state: high ? .high : .low, height: turn.height, rising: high, rate: rate)
    }
    let rising = extremes.first(where: { $0.time > time }).map { $0.kind == .high } ?? (rate >= 0)
    return TideReading(state: rising ? .rising : .falling, height: height, rising: rising, rate: rate)
}

extension Array where Element == TideExtreme {
    /// The height of every rise and fall in `ranges()`.
    public func swingHeights() -> [Double] { ranges().map(\.height) }
}
