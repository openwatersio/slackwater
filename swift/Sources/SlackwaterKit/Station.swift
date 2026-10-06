// Slackwater — MIT. Public prediction API.
import Foundation

/// A harmonic constituent for a station: amplitude in metres, phase (K) in degrees.
public struct HarmonicConstituent: Sendable {
    public let name: String
    public let amplitude: Double
    public let phase: Double
    public init(name: String, amplitude: Double, phase: Double) {
        self.name = name
        self.amplitude = amplitude
        self.phase = phase
    }
}

public struct TidePoint: Sendable {
    public let time: Date
    public let height: Double
    public init(time: Date, height: Double) { self.time = time; self.height = height }
}
public struct TideRatePoint: Sendable {
    public let time: Date
    public let rate: Double
    public init(time: Date, rate: Double) { self.time = time; self.rate = rate }
}
public enum ExtremeKind: Sendable { case high, low }
public struct TideExtreme: Sendable {
    public let time: Date
    public let height: Double
    public let kind: ExtremeKind
    public init(time: Date, height: Double, kind: ExtremeKind) {
        self.time = time; self.height = height; self.kind = kind
    }
}

/// A tide/current station: a set of harmonic constituents plus a datum offset (m).
/// Predictions are fully offline and deterministic — no network, any date.
public struct Station: Sendable {
    let constituents: [StationConstituent]
    let catalog: Catalog

    /// - Parameters:
    ///   - constituents: station harmonic constants (unknown names are ignored).
    ///   - offset: constant datum offset (metres), added as a Z0 term so it applies
    ///     uniformly to heights and extremes (the Slackwater convention).
    public init(constituents inputs: [HarmonicConstituent], offset: Double = 0) {
        let d2r = Double.pi / 180
        let cat = Catalog.shared
        self.catalog = cat
        var cs = inputs
            .filter { cat.entry($0.name) != nil }
            .map { StationConstituent(name: $0.name, amplitude: $0.amplitude, phase: d2r * $0.phase) }
        if offset != 0 { cs.append(StationConstituent(name: "Z0", amplitude: offset, phase: 0)) }
        self.constituents = cs
    }

    /// Height series (metres) from `from` to `to`, sampled every `step` seconds.
    /// Timeline is floored/ceiled to `step` (matches the Slackwater reference).
    public func heights(from: Date, to: Date, step: TimeInterval = 600) -> [TidePoint] {
        let timeline = makeTimeline(from: from, to: to, step: step)
        guard let first = timeline.items.first else { return [] }
        let base = astro(first)
        let provider = ParamProvider(constituents: constituents, baseAstro: base, catalog: catalog,
                                     startMs: timeline.startMs, endHour: timeline.endHour)
        return zip(timeline.items, timeline.hours).map { item, hour in
            TidePoint(time: item, height: evalH(hour, provider(hour)))
        }
    }

    /// Rate-of-change series dh/dt (metres/hour) on the same floored/ceiled
    /// timeline as `heights` — index i of both series shares one timestamp.
    /// Analytic (the derivative sum evalHPrime), not sample differencing.
    public func rates(from: Date, to: Date, step: TimeInterval = 600) -> [TideRatePoint] {
        let timeline = makeTimeline(from: from, to: to, step: step)
        guard let first = timeline.items.first else { return [] }
        let base = astro(first)
        let provider = ParamProvider(constituents: constituents, baseAstro: base, catalog: catalog,
                                     startMs: timeline.startMs, endHour: timeline.endHour)
        return zip(timeline.items, timeline.hours).map { item, hour in
            TideRatePoint(time: item, rate: evalHPrime(hour, provider(hour)))
        }
    }
}
