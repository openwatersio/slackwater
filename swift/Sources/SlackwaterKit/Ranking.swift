// Slackwater — MIT. Where a tide sits among its neighbours.
//
// A tide is only remarkable relative to the other tides around it. Nothing here
// is new astronomy: the constituents already carry spring/neap (M2⊕S2), the
// perigean beat (M2⊕N2), the declinational fortnight (K1⊕O1) and the seasonal
// envelope (Sa, Ssa), plus whatever the local shallow water does to them. Rank
// the output of `extremes()` and a "king tide" falls out as a top-percentile
// low — including the local distortion an astronomical rule would miss.
//
// The window is the caller's to choose, and it is a real choice: ranking over a
// year only means something when the constituents resolve a year. A fitted set
// with no Sa/Ssa can speak to the fortnight and not to the season.
import Foundation

/// Two adjacent extremes of opposite kind — one rise, or one fall.
public struct TideRange: Sendable {
    public let low: TideExtreme
    public let high: TideExtreme

    public init(low: TideExtreme, high: TideExtreme) {
        self.low = low
        self.high = high
    }

    /// The water between the two turns. Positive: `ranges()` never builds a
    /// pair where the high sits at or below the low, which a subordinate's
    /// independent high/low corrections can otherwise produce.
    public var height: Double { high.height - low.height }
    /// When the range completes — the later of the two turns.
    public var time: Date { Swift.max(low.time, high.time) }
    /// True for a flood (low then high), false for an ebb.
    public var isRising: Bool { low.time < high.time }
}

extension Collection where Element == TideExtreme {
    /// Every adjacent opposite-kind pair, in time order — each rise *and* each
    /// fall, so a semidiurnal day yields about four. Both are included because
    /// you are standing in one or the other right now, and "the biggest swing
    /// since March" should be able to name either.
    ///
    /// Same-kind neighbours collapse to the run's true extreme. Between two
    /// minima of a continuous curve there is always a maximum, so two lows in a
    /// row mean the turn between them is missing — a subordinate's unequal time
    /// corrections reordered it, or the root finder missed it — not that the
    /// water held a double low. That water is one long rise, so the lower of the
    /// two lows is where the next rise starts from. Collapsing rather than
    /// skipping keeps the swing someone actually stood in.
    ///
    /// A pair whose high sits at or below its low is dropped. That cannot happen
    /// on a harmonic station, but a subordinate corrects highs and lows
    /// independently, so `.ratio(high: 0.5, low: 1.0)` over a shallow neap — or
    /// a `.fixed` pair whose high correction sits below its low one — can invert
    /// it. Such a "range" is an artifact of the offsets, not water, and would
    /// otherwise rank as the window's smallest swing.
    ///
    /// ponytail: trusts the caller's sort; both engine producers guarantee it.
    public func ranges() -> [TideRange] {
        var out: [TideRange] = []
        var iterator = makeIterator()
        guard var previous = iterator.next() else { return out }
        while let current = iterator.next() {
            guard previous.kind != current.kind else {
                // Keep the lower low, or the higher high, of the run.
                if (current.kind == .low) == (current.height < previous.height) {
                    previous = current
                }
                continue
            }
            let low = previous.kind == .low ? previous : current
            let high = previous.kind == .low ? current : previous
            previous = current
            guard high.height > low.height else { continue }
            out.append(TideRange(low: low, high: high))
        }
        return out
    }
}

// ponytail: extends [Double] app-wide; move under a caseless enum if it ever
// collides with a consumer's own statistics.
extension Collection where Element == Double {
    /// Fraction of the collection at or below `value`, 0…1. Ties count as
    /// below, so the smallest member of a tie-free set ranks 1/count and
    /// nothing ranks 0 — a low that ties the window's lowest still reads as
    /// "nothing here was lower". `nil` when empty.
    public func percentileRank(of value: Double) -> Double? {
        guard !isEmpty else { return nil }
        return Double(lazy.filter { $0 <= value }.count) / Double(count)
    }

    /// The value at fraction `p`, nearest-rank, `p` clamped to 0…1. `percentile(0)`
    /// is the minimum and `percentile(1)` the maximum. `nil` when empty.
    public func percentile(_ p: Double) -> Double? {
        guard !isEmpty else { return nil }
        let ranked = sorted()
        let position = Swift.min(Swift.max(p, 0), 1) * Double(ranked.count - 1)
        return ranked[Int(position.rounded())]
    }
}
