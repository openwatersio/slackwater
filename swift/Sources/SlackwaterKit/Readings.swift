// Slackwater — MIT. What the water is doing at an instant, read from a sampled
// current series and its events. Mirrors packages/engine/src/readings/{series,current}.ts.
import Foundation

/// The indices of the samples bracketing `time`: the last at or before it and the one after; nil outside the samples.
func bracket<T>(_ points: [T], at time: Date, _ instant: (T) -> Date) -> (lo: Int, hi: Int)? {
    var lo = 0, hi = points.count - 1
    guard hi >= 0, time >= instant(points[0]), time <= instant(points[hi]) else { return nil }
    while hi - lo > 1 {
        let mid = (lo + hi) / 2
        if instant(points[mid]) <= time { lo = mid } else { hi = mid }
    }
    return (lo, hi)
}

/// `value` at `time`, linearly interpolated between sorted samples; nil outside them.
func interpolate<T>(_ points: [T], at time: Date, _ instant: (T) -> Date, _ value: (T) -> Double) -> Double? {
    guard let pair = bracket(points, at: time, instant) else { return nil }
    let a = points[pair.lo], b = points[pair.hi]
    let span = instant(b).timeIntervalSince(instant(a))
    return span == 0 ? value(a) : value(a) + (value(b) - value(a)) * time.timeIntervalSince(instant(a)) / span
}

/// Whether two instants fall within one second, counted in whole milliseconds as the TypeScript engine's dates are.
func withinOneSecond(_ a: Date, _ b: Date) -> Bool {
    abs((a.timeIntervalSince1970 * 1000).rounded() - (b.timeIntervalSince1970 * 1000).rounded()) <= 1000
}

/// The full current vector at an instant.
public struct CurrentVector: Sendable, Equatable {
    public let magnitude: Double
    /// Predicted set in degrees true; nil at zero speed or when unknown.
    public let direction: Double?
    public init(magnitude: Double, direction: Double?) { self.magnitude = magnitude; self.direction = direction }
}

/// The phase of the tide a current reading falls in.
public enum CurrentState: Sendable, Equatable { case slack, maxFlood, maxEbb, minFlood, minEbb, flooding, ebbing }

/// The lead reading at an instant: phase, signed major-axis speed, and the full vector.
public struct CurrentReading: Sendable, Equatable {
    public let state: CurrentState
    public let speed: Double
    public let magnitude: Double
    /// Predicted set in degrees true; nil at zero speed or when unknown.
    public let direction: Double?
    public init(state: CurrentState, speed: Double, magnitude: Double, direction: Double?) {
        self.state = state; self.speed = speed; self.magnitude = magnitude; self.direction = direction
    }
}

/// The 16 compass points as abbreviations, clockwise from north.
public let compassPoints = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(separator: " ").map(String.init)

/// The 16 compass points as spoken words, in the order of `compassPoints`.
public let spokenCompassPoints = [
    "north", "north-northeast", "northeast", "east-northeast",
    "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest",
    "west", "west-northwest", "northwest", "north-northwest",
]

/// The index into the compass point lists nearest a bearing in degrees; a non-finite bearing reads as north.
public func compassIndex(_ degrees: Double) -> Int {
    guard degrees.isFinite else { return 0 }
    // Rounds halves up, as JavaScript's Math.round does, so a bearing reads the same on every platform.
    let x = degrees.truncatingRemainder(dividingBy: 360) / 22.5
    let floor = x.rounded(.down)
    let nearest = Int(x - floor >= 0.5 ? floor + 1 : floor)
    return (nearest % 16 + 16) % 16
}

/// A bearing in degrees true as a 16-point compass abbreviation.
public func compassPoint(_ degrees: Double) -> String { compassPoints[compassIndex(degrees)] }

extension CurrentPoint {
    /// The magnitude a reading may trust, or nil for a one-axis sample whose set comes from the published bearings.
    /// A zero sample is a zero vector either way, and reads as one so a vector series can turn through it.
    fileprivate var knownMagnitude: Double? {
        direction == nil && magnitude == abs(speed) && magnitude != 0 ? nil : magnitude
    }
}

extension Array where Element == CurrentPoint {
    /// Signed speed at `time`, linearly interpolated; nil outside the series.
    public func speed(at time: Date) -> Double? { interpolate(self, at: time, \.time, \.speed) }

    /// The current vector at `time`, interpolated through bearings; nil outside the series.
    /// A sample with no direction and a magnitude of `abs(speed)` is one-axis and takes `flood` or `ebb` by its sign.
    public func vector(at time: Date, flood: Double?, ebb: Double?) -> CurrentVector? {
        guard let speed = speed(at: time), let pair = bracket(self, at: time, \.time) else { return nil }
        func vector(_ magnitude: Double, _ direction: Double?) -> CurrentVector {
            CurrentVector(magnitude: magnitude, direction: magnitude > 1e-9 ? direction : nil)
        }
        let a = self[pair.lo], b = self[pair.hi]
        let span = b.time.timeIntervalSince(a.time)
        let mix = span == 0 ? 0 : time.timeIntervalSince(a.time) / span
        if mix == 0 || mix == 1 {
            let p = mix == 0 ? a : b
            guard let magnitude = p.knownMagnitude else { return vector(abs(speed), speed >= 0 ? flood : ebb) }
            return vector(magnitude, p.direction)
        }
        // Scalar phase bearings need not be reciprocal; their reversal must not synthesize crossflow.
        let axialReversal = a.knownMagnitude == abs(a.speed) && b.knownMagnitude == abs(b.speed) && a.speed * b.speed < 0
        guard let am = a.knownMagnitude, let bm = b.knownMagnitude, !axialReversal else {
            let direction = axialReversal ? ((speed >= 0) == (a.speed >= 0) ? a : b).direction : speed >= 0 ? flood : ebb
            return vector(abs(speed), direction)
        }
        if (am != 0 && a.direction == nil) || (bm != 0 && b.direction == nil) {
            return CurrentVector(magnitude: am + (bm - am) * mix, direction: nil)
        }
        // Interpolate vectors so north crossings and opposing flows retain their physical meaning.
        let radians = Double.pi / 180
        let ad = (a.direction ?? 0) * radians, bd = (b.direction ?? 0) * radians
        let x = am * sin(ad) * (1 - mix) + bm * sin(bd) * mix
        let y = am * cos(ad) * (1 - mix) + bm * cos(bd) * mix
        let bearing = (atan2(x, y) / radians).truncatingRemainder(dividingBy: 360)
        return vector(hypot(x, y), (bearing + 360).truncatingRemainder(dividingBy: 360))
    }
}

/// The lead reading at `time`: slack or extremum within a second of an event, otherwise the flooding or ebbing phase.
public func readCurrent(at time: Date, timeline: [CurrentPoint], events: [CurrentEvent],
                        flood: Double?, ebb: Double?) -> CurrentReading? {
    guard let speed = timeline.speed(at: time),
          let vector = timeline.vector(at: time, flood: flood, ebb: ebb) else { return nil }
    let state: CurrentState
    if events.contains(where: { $0.kind == .slack && withinOneSecond($0.time, time) }) {
        state = .slack
    } else if let event = events.first(where: { $0.kind != .slack && withinOneSecond($0.time, time) }) {
        switch event.kind {
        case .maxFlood: state = .maxFlood
        case .maxEbb: state = .maxEbb
        case .minFlood: state = .minFlood
        case .minEbb: state = .minEbb
        case .slack: state = .slack
        }
    } else {
        state = speed >= 0 ? .flooding : .ebbing
    }
    return CurrentReading(state: state, speed: speed, magnitude: vector.magnitude, direction: vector.direction)
}

extension Array where Element == CurrentEvent {
    /// One kind's maxima as unsigned speeds, so floods rank against floods and ebbs against ebbs.
    public func maxSpeeds(_ kind: CurrentEventKind) -> [Double] { filter { $0.kind.isMaximum && $0.kind == kind }.map { abs($0.speed) } }
}

/// The default major-axis speed threshold for slack windows, in knots.
public let defaultSlackThreshold = 0.5

/// A span of workable water around one or more slacks.
public struct SlackWindow: Sendable, Equatable {
    public let start: Date
    public let end: Date
    public init(start: Date, end: Date) { self.start = start; self.end = end }
}

/// Where the straight line between one sample inside the ±`threshold` band and one outside it crosses the band's edge.
/// Signed, so a pair either side of a reversal crosses on the outside sample's side rather than at a mirrored speed.
private func bandCrossing(_ a: CurrentPoint, _ b: CurrentPoint, threshold: Double) -> Date {
    let outside = abs(a.speed) > threshold ? a.speed : b.speed
    let edge = outside > 0 ? threshold : -threshold
    let f = (edge - a.speed) / (b.speed - a.speed)
    return a.time.addingTimeInterval(b.time.timeIntervalSince(a.time) * f)
}

/// The workable window around a slack: where |speed| stays within `threshold`, clamped to the series and widened to hold the slack.
/// Nil for a slack outside the series, between two out-of-band samples of one sign, or at a threshold at or below zero.
public func slackWindow(_ points: [CurrentPoint], around slack: Date, threshold: Double) -> SlackWindow? {
    guard threshold > 0, let first = points.first, let last = points.last,
          slack >= first.time, slack <= last.time else { return nil }
    let i = points.lastIndex(where: { $0.time <= slack }) ?? 0
    let k: Int
    if abs(points[i].speed) <= threshold { k = i }
    else if i + 1 < points.count, abs(points[i + 1].speed) <= threshold { k = i + 1 }
    else if i + 1 < points.count, (points[i].speed > 0) != (points[i + 1].speed > 0) {
        // A reversal between two out-of-band samples crosses the band along the straight segment of signed speed.
        let a = points[i], b = points[i + 1]
        let span = abs(a.speed) + abs(b.speed), dt = b.time.timeIntervalSince(a.time)
        return SlackWindow(start: min(a.time.addingTimeInterval(dt * (abs(a.speed) - threshold) / span), slack),
                           end: max(a.time.addingTimeInterval(dt * (abs(a.speed) + threshold) / span), slack))
    }
    else { return nil }
    var start = first.time
    var a = k
    while a > 0 {
        if abs(points[a - 1].speed) > threshold { start = bandCrossing(points[a - 1], points[a], threshold: threshold); break }
        a -= 1
    }
    var end = last.time
    var b = k
    while b < points.count - 1 {
        if abs(points[b + 1].speed) > threshold { end = bandCrossing(points[b], points[b + 1], threshold: threshold); break }
        b += 1
    }
    return SlackWindow(start: min(start, slack), end: max(end, slack))
}

/// Windows in chronological order merged into runs: a window joins the run before it when it starts at or before that run ends.
public func mergeWindows(_ windows: [SlackWindow]) -> [SlackWindow] {
    var runs: [SlackWindow] = []
    for w in windows {
        if let last = runs.last, w.start <= last.end {
            runs[runs.count - 1] = SlackWindow(start: last.start, end: max(last.end, w.end))
        } else {
            runs.append(w)
        }
    }
    return runs
}

/// The windows around the slacks inside the series merged into runs; a slack with no window stays an exact instant.
public func slackRuns(_ points: [CurrentPoint], events: [CurrentEvent], threshold: Double) -> [SlackWindow] {
    guard let first = points.first?.time, let last = points.last?.time else { return [] }
    let windows = events
        .filter { $0.kind == .slack && $0.time >= first && $0.time <= last }
        .map { slackWindow(points, around: $0.time, threshold: threshold) ?? SlackWindow(start: $0.time, end: $0.time) }
        .sorted { $0.start < $1.start }
    return mergeWindows(windows)
}
