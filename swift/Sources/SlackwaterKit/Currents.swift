// Slackwater — MIT. Tidal current prediction: velocity, max flood/ebb, and slack.
// Max flood/ebb are slope-zeros (reuses Extremes.findExtremes). Slack is the
// value-zero of velocity — the one genuinely new finder here.
import Foundation

private let slackToleranceHours = 1.0 / 3600  // 1 second

struct RawSlack { let hour: Double; let time: Date; let speed: Double }

/// Root of v(t) in [a, b] where v(a), v(b) have opposite signs. Bisection on evalH.
private func bisectZero(_ a0: Double, _ b0: Double, _ fa0: Double, _ params: [PreparedParam]) -> Double {
    var a = a0, b = b0, fa = fa0
    while true {
        let mid = (a + b) / 2
        if b - a < slackToleranceHours { return mid }
        let fMid = evalH(mid, params)
        if fMid == 0 { return mid }
        if fa > 0 ? fMid > 0 : fMid < 0 { a = mid; fa = fMid } else { b = mid }
    }
}

/// Slack instants (velocity value-zeros) in [fromHour, toHour]. Mirrors the
/// bracket-and-bisect structure of findExtremes, but roots evalH not evalHPrime.
func findSlacks(fromHour: Double, toHour: Double, provider: ParamProvider) -> [RawSlack] {
    var params = provider(max(0, fromHour))
    var lastGen = provider.generation
    if params.isEmpty { return [] }

    var maxSpeed = 0.0
    for p in params where p.w > maxSpeed { maxSpeed = p.w }
    if maxSpeed == 0 { return [] }
    let bracket = Double.pi / (2 * maxSpeed)

    var results: [RawSlack] = []
    var tPrev = fromHour
    var vPrev = evalH(tPrev, params)
    var tNext = tPrev + bracket
    while tNext <= toHour + bracket {
        let newParams = provider(tPrev)
        if provider.generation != lastGen { params = newParams; lastGen = provider.generation; vPrev = evalH(tPrev, params) }
        let tBound = min(tNext, toHour)
        let vNext = evalH(tBound, params)
        if vPrev != 0 && vNext != 0 && (vPrev > 0 ? vNext < 0 : vNext > 0) {
            let tRoot = bisectZero(tPrev, tBound, vPrev, params)
            if tRoot >= fromHour && tRoot <= toHour {
                results.append(RawSlack(hour: tRoot,
                                        time: Date(timeIntervalSince1970: provider.startMs / 1000 + tRoot * 3600),
                                        speed: evalH(tRoot, params)))
            }
        }
        if tBound >= toHour { break }
        tPrev = tBound
        vPrev = vNext
        tNext += bracket
    }
    return results
}

public struct CurrentPoint: Sendable {
    public let time: Date; public let speed: Double
    // Public init so a consumer can synthesize a series (a derived gate's
    // schematic curve has no harmonic station to predict from).
    public init(time: Date, speed: Double) { self.time = time; self.speed = speed }
}
public enum CurrentEventKind: Sendable { case slack, maxFlood, maxEbb }
public struct CurrentEvent: Sendable {
    public let time: Date; public let speed: Double; public let kind: CurrentEventKind
    public init(time: Date, speed: Double, kind: CurrentEventKind) {
        self.time = time; self.speed = speed; self.kind = kind
    }
}

/// A harmonic current station. Same constituent math as `Station`; the prediction
/// is signed major-axis velocity (knots) — positive = flood, negative = ebb.
public struct CurrentStation: Sendable {
    let constituents: [StationConstituent]
    let catalog: Catalog
    public let floodDirection: Double
    public let ebbDirection: Double

    /// - floodDirection: NOAA `azi` (major-axis azimuth, deg true).
    /// - ebbDirection: azi + 180 (mod 360).
    /// - offset: NOAA `majorMeanSpeed` (mean flow, knots) as the Z₀ term.
    public init(constituents inputs: [HarmonicConstituent],
                floodDirection: Double, ebbDirection: Double, offset: Double = 0) {
        let d2r = Double.pi / 180
        let cat = Catalog.shared
        self.catalog = cat
        self.floodDirection = floodDirection
        self.ebbDirection = ebbDirection
        var cs = inputs
            .filter { cat.entry($0.name) != nil }
            .map { StationConstituent(name: $0.name, amplitude: $0.amplitude, phase: d2r * $0.phase) }
        if offset != 0 { cs.append(StationConstituent(name: "Z0", amplitude: offset, phase: 0)) }
        self.constituents = cs
    }

    private func provider(from: Date, to: Date, step: Double = 600) -> (ParamProvider, Double) {
        let startSec = (from.timeIntervalSince1970 / step).rounded(.down) * step
        let endSec = (to.timeIntervalSince1970 / step).rounded(.up) * step
        let endHour = max(0, (endSec - startSec) / 3600)
        let base = astro(Date(timeIntervalSince1970: startSec))
        let p = ParamProvider(constituents: constituents, baseAstro: base, catalog: catalog,
                              startMs: startSec * 1000, endHour: endHour)
        return (p, endHour)
    }

    /// Signed major-axis velocity series (knots), sampled every `step` seconds.
    public func speeds(from: Date, to: Date, step: TimeInterval = 600) -> [CurrentPoint] {
        let timeline = makeTimeline(from: from, to: to, step: step)
        guard let first = timeline.items.first else { return [] }
        let base = astro(first)
        let p = ParamProvider(constituents: constituents, baseAstro: base, catalog: catalog,
                              startMs: timeline.startMs, endHour: timeline.endHour)
        return zip(timeline.items, timeline.hours).map { item, hour in
            CurrentPoint(time: item, speed: evalH(hour, p(hour)))
        }
    }

    /// Max flood / max ebb — velocity extrema (slope-zeros). Classified by the SIGN
    /// of velocity, not slope high/low (NOAA's convention): a relaxation extremum
    /// that never reverses stays flood or ebb per its sign. Matches NOAA max_slack.
    public func maxima(from: Date, to: Date) -> [CurrentEvent] {
        let (p, endHour) = provider(from: from, to: to)
        let raw = findExtremes(fromHour: 0, toHour: endHour, provider: p, prominenceThreshold: 0.01)
        return raw.map { CurrentEvent(time: $0.time, speed: $0.level,
                                      kind: $0.level >= 0 ? .maxFlood : .maxEbb) }
    }

    /// Slack water — velocity value-zeros.
    public func slacks(from: Date, to: Date) -> [CurrentEvent] {
        let (p, endHour) = provider(from: from, to: to)
        return findSlacks(fromHour: 0, toHour: endHour, provider: p)
            .map { CurrentEvent(time: $0.time, speed: $0.speed, kind: .slack) }
    }

    /// Slacks + maxima merged in time order — the app-facing event list.
    public func events(from: Date, to: Date) -> [CurrentEvent] {
        (slacks(from: from, to: to) + maxima(from: from, to: to))
            .sorted { $0.time < $1.time }
    }
}

extension CurrentStation {
    /// The margin each day is searched with on either side. Neighbouring events
    /// are at most ~6 h apart (diurnal), so a day's own events always have
    /// their neighbours in view when the prominence filter runs.
    static let dayMargin: TimeInterval = 8 * 3600

    /// Events over whole UTC days covering `from...to`, each day searched on
    /// its own with `dayMargin` either side and trimmed to the day. The list
    /// for any range is therefore a concatenation of per-day lists and never
    /// depends on the range asked for — `events(from:to:)` can: the extrema
    /// search refreshes node corrections every 24 h from its own start, so two
    /// searches can disagree at a flat turn near a refresh. A subordinate
    /// reduces these, and so can a caller holding them for many subordinates.
    public func eventsByDay(from: Date, to: Date) -> [CurrentEvent] {
        let day = 86_400.0
        let first = (from.timeIntervalSince1970 / day).rounded(.down)
        let last = (to.timeIntervalSince1970 / day).rounded(.down)
        guard last >= first else { return [] }
        return stride(from: first, through: last, by: 1).flatMap { d -> [CurrentEvent] in
            let start = Date(timeIntervalSince1970: d * day), end = start.addingTimeInterval(day)
            return events(from: start.addingTimeInterval(-Self.dayMargin), to: end.addingTimeInterval(Self.dayMargin))
                .filter { $0.time >= start && $0.time < end }
        }
    }
}

/// A subordinate current station: no constituents of its own. Its events are the
/// reference station's events, time-shifted and speed-scaled by NOAA's Current-Tables
/// offsets. NOAA gives TWO slack offsets — slack-before-flood and slack-before-ebb —
/// plus per-phase max time offsets and speed ratios. Event list only — no curve.
public struct SubordinateStation: Sendable {
    public let reference: CurrentStation
    public let slackBeforeFloodOffset: TimeInterval  // NOAA sbfTimeAdjMin
    public let slackBeforeEbbOffset: TimeInterval     // NOAA sbeTimeAdjMin
    public let floodTimeOffset: TimeInterval           // NOAA mfcTimeAdjMin
    public let ebbTimeOffset: TimeInterval             // NOAA mecTimeAdjMin
    public let floodSpeedRatio: Double                 // NOAA mfcAmpAdj
    public let ebbSpeedRatio: Double                   // NOAA mecAmpAdj
    public let floodDirection: Double
    public let ebbDirection: Double

    public init(reference: CurrentStation,
                slackBeforeFloodOffset: TimeInterval, slackBeforeEbbOffset: TimeInterval,
                floodTimeOffset: TimeInterval, ebbTimeOffset: TimeInterval,
                floodSpeedRatio: Double, ebbSpeedRatio: Double,
                floodDirection: Double, ebbDirection: Double) {
        self.reference = reference
        self.slackBeforeFloodOffset = slackBeforeFloodOffset
        self.slackBeforeEbbOffset = slackBeforeEbbOffset
        self.floodTimeOffset = floodTimeOffset
        self.ebbTimeOffset = ebbTimeOffset
        self.floodSpeedRatio = floodSpeedRatio
        self.ebbSpeedRatio = ebbSpeedRatio
        self.floodDirection = floodDirection
        self.ebbDirection = ebbDirection
    }

    public func events(from: Date, to: Date) -> [CurrentEvent] {
        let pad = [slackBeforeFloodOffset, slackBeforeEbbOffset, floodTimeOffset, ebbTimeOffset]
            .map(abs).max()! + 3600
        let refEvents = reference.eventsByDay(from: from.addingTimeInterval(-pad),
                                              to: to.addingTimeInterval(pad))
        return reduce(refEvents).filter { $0.time >= from && $0.time <= to }
    }

    /// The reduction alone, over reference events a caller already holds — a
    /// map full of pins hanging off one reference searches that reference once
    /// (`eventsByDay`, so the list matches what `events`/`speeds` would use)
    /// and reduces per pin. Sorted; unequal offsets can reorder neighbours.
    public func reduce(_ refEvents: [CurrentEvent]) -> [CurrentEvent] {
        refEvents.enumerated().map { (i, e) -> CurrentEvent in
            switch e.kind {
            case .maxFlood: return CurrentEvent(time: e.time.addingTimeInterval(floodTimeOffset), speed: e.speed * floodSpeedRatio, kind: .maxFlood)
            case .maxEbb:   return CurrentEvent(time: e.time.addingTimeInterval(ebbTimeOffset), speed: e.speed * ebbSpeedRatio, kind: .maxEbb)
            case .slack:
                // Slack takes the offset for the phase it precedes: the next non-slack event.
                let next = refEvents[(i + 1)...].first { $0.kind != .slack }
                let off = next?.kind == .maxEbb ? slackBeforeEbbOffset : slackBeforeFloodOffset
                return CurrentEvent(time: e.time.addingTimeInterval(off), speed: 0, kind: .slack)
            }
        }.sorted { $0.time < $1.time }
    }

    /// Signed speed at one instant along reduced events that bracket it — the
    /// same half-cosine `speeds` draws, for a caller holding the events.
    public static func speed(at t: Date, along events: [CurrentEvent]) -> Double {
        halfCosineCurve(through: events.map { ($0.time, $0.speed) }, on: [t]).first?.value ?? 0
    }

    /// Signed speed series (knots) on the same floored/ceiled timeline as
    /// `CurrentStation.speeds`: a half-cosine between neighbouring events. NOAA
    /// publishes no curve for a subordinate, so this is a drawing of the table,
    /// not a prediction of the water between its rows.
    public func speeds(from: Date, to: Date, step: TimeInterval = 600) -> [CurrentPoint] {
        // Neighbouring events are ~3 h apart at a semidiurnal station and ~6 h at
        // a diurnal one; 8 h always brackets the window. Every hour of pad is a
        // longer search over the reference, and a map full of pins pays it.
        let pad = 8.0 * 3600
        let ev = events(from: from.addingTimeInterval(-pad), to: to.addingTimeInterval(pad))
        return halfCosineCurve(through: ev.map { ($0.time, $0.speed) },
                               on: makeTimeline(from: from, to: to, step: step).items)
            .map { CurrentPoint(time: $0.time, speed: $0.value) }
    }
}
