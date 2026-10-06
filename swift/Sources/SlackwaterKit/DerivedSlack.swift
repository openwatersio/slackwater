// Slackwater — MIT. Derived-slack gates: a pass (Malibu Rapids) with NO current
// station of its own. Slack is the reference tide port's high/low water shifted
// by a fixed lag; the pass floods on the rising tide and ebbs on the falling one.
// So slack TIMES and a flood/ebb PHASE are honest — but never a speed, which CHS
// does not predict for these passes.
//
// Mirror of slackwater-web/src/chs/current.ts (deriveCurrentState /
// schematicSignedAt / derivedNowFields). Keep the two in step.
import Foundation

/// A derived slack: the reference port's extreme, shifted by the lag. `highWater`
/// distinguishes a slack at high water (current turns to ebb) from one at low
/// water (turns to flood).
public struct DerivedSlackEvent: Sendable {
    public let time: Date
    public let highWater: Bool
}

public enum DerivedPhase: Sendable { case flood, ebb, slack }

public struct DerivedSlackStation: Sendable {
    let reference: Station
    public let hwLagMinutes: Double
    public let lwLagMinutes: Double

    /// Within this of a derived slack, the gate reads "Slack" rather than flood/ebb.
    static let slackWindowMinutes = 12.0

    public init(reference: Station, hwLagMinutes: Double, lwLagMinutes: Double) {
        self.reference = reference
        self.hwLagMinutes = hwLagMinutes
        self.lwLagMinutes = lwLagMinutes
    }

    /// Reference HW/LW in `[from, to]`, each shifted by its lag → derived slacks.
    public func slacks(from: Date, to: Date) -> [DerivedSlackEvent] {
        // Pad so an extreme just outside the window whose shifted slack lands inside
        // still shows up; then clip to the requested window.
        let pad = max(abs(hwLagMinutes), abs(lwLagMinutes)) * 60 + 3600
        return reference.extremes(from: from.addingTimeInterval(-pad), to: to.addingTimeInterval(pad))
            .map { ex in
                let lag = (ex.kind == .high ? hwLagMinutes : lwLagMinutes) * 60
                return DerivedSlackEvent(time: ex.time.addingTimeInterval(lag), highWater: ex.kind == .high)
            }
            .filter { $0.time >= from && $0.time <= to }
            .sorted { $0.time < $1.time }
    }

    /// A magnitude-LESS shape normalised to [-1, 1] — NOT a speed. Between two
    /// consecutive slacks the current traces a half-sine, signed by phase (flood
    /// after a low-water slack, ebb after a high-water slack), peaking at ±1
    /// mid-cycle. Zero outside the slack range. Exists only so the gate has a
    /// curve to draw; the axis carries no knots.
    public func schematicSigned(at t: Date, slacks: [DerivedSlackEvent]) -> Double {
        let tt = t.timeIntervalSince1970
        guard slacks.count >= 2 else { return 0 }
        for i in 1..<slacks.count {
            let a = slacks[i - 1].time.timeIntervalSince1970
            let b = slacks[i].time.timeIntervalSince1970
            if tt >= a && tt <= b {
                let sign = slacks[i - 1].highWater ? -1.0 : 1.0  // ebb after HW slack, flood after LW slack
                return sign * sin(Double.pi * ((tt - a) / (b - a)))
            }
        }
        return 0
    }

    /// Flood/ebb/slack at `t`, from the tide trend alone — no speed. Heading toward a
    /// high-water slack ⇒ tide rising ⇒ flooding; toward low water ⇒ ebbing. Within
    /// `slackWindowMinutes` of any slack it reads slack.
    ///
    /// Takes the caller's already-derived `slacks` rather than recomputing: the
    /// prominence filter behind `extremes` is window-relative, so a fresh
    /// derive over a different window can disagree about which slack is "next" at a
    /// diurnal transition. Mirrors current.ts `withNowCurrent`, which feeds the one
    /// event set into `derivedNowFields`.
    public func phase(at t: Date, slacks: [DerivedSlackEvent]) -> DerivedPhase {
        guard !slacks.isEmpty else { return .slack }
        let nowMs = t.timeIntervalSince1970
        let nextSlack = slacks.first { $0.time.timeIntervalSince1970 > nowMs }
        let best = slacks.map { abs($0.time.timeIntervalSince1970 - nowMs) }.min() ?? .infinity
        if best <= Self.slackWindowMinutes * 60 { return .slack }
        // Toward the next slack's water level; past the last slack, invert its origin.
        let rising = nextSlack?.highWater ?? !(slacks.last!.highWater)
        return rising ? .flood : .ebb
    }
}
