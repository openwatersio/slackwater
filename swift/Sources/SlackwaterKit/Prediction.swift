// Slackwater — MIT. Harmonic prediction core.
// Faithful port of @slackwater/engine src/harmonics (prediction + evalH + timeline).
// h(t) = offset + Σ Aᵢ·f·cos(ωᵢ·t + V₀ᵢ + uᵢ − Kᵢ), t in hours from the timeline start.
import Foundation

private let d2r = Double.pi / 180
let correctionIntervalHours = 24.0

struct PreparedParam { let A: Double; let w: Double; let phi: Double }

/// h(t) = Σ A·cos(w·t + phi)
func evalH(_ t: Double, _ params: [PreparedParam]) -> Double {
    var sum = 0.0
    for p in params { sum += p.A * cos(p.w * t + p.phi) }
    return sum
}
/// h'(t) = -Σ A·w·sin(w·t + phi)
func evalHPrime(_ t: Double, _ params: [PreparedParam]) -> Double {
    var sum = 0.0
    for p in params { sum -= p.A * p.w * sin(p.w * t + p.phi) }
    return sum
}
/// h''(t) = -Σ A·w²·cos(w·t + phi)
func evalHDoublePrime(_ t: Double, _ params: [PreparedParam]) -> Double {
    var sum = 0.0
    for p in params { sum -= p.A * p.w * p.w * cos(p.w * t + p.phi) }
    return sum
}

/// A filtered constituent: catalog-known, with amplitude (m) and phase (radians).
struct StationConstituent { let name: String; let amplitude: Double; let phase: Double }

/// Prepares constituent params with node corrections recomputed every 24h at the
/// chunk midpoint — the Slackwater `correctedParams` scheme. Node corrections drift
/// <0.01%/day, so per-day recomputation is exact enough and matches the reference.
final class ParamProvider {
    private let constituents: [StationConstituent]
    private let baseAstro: Astro
    private let catalog: Catalog
    let startMs: Double
    private let endHour: Double
    private var params: [PreparedParam]
    private var nextCorrectionAt: Double
    /// Bumped whenever params are recomputed — lets callers detect a refresh
    /// (Slackwater uses array identity `!==`; Swift arrays are value types).
    private(set) var generation = 0

    init(constituents: [StationConstituent], baseAstro: Astro, catalog: Catalog, startMs: Double, endHour: Double) {
        self.constituents = constituents
        self.baseAstro = baseAstro
        self.catalog = catalog
        self.startMs = startMs
        self.endHour = endHour
        let firstCorrection = startMs + min(correctionIntervalHours, endHour) / 2 * 3.6e6
        self.params = Self.prepare(constituents, baseAstro, catalog, Date(timeIntervalSince1970: firstCorrection / 1000))
        self.nextCorrectionAt = correctionIntervalHours
    }

    func callAsFunction(_ hour: Double) -> [PreparedParam] {
        if hour >= nextCorrectionAt {
            // Catch up to the chunk holding `hour`, however many chunks it skips.
            nextCorrectionAt += ((hour - nextCorrectionAt) / correctionIntervalHours).rounded(.down) * correctionIntervalHours
            let chunkEnd = min(nextCorrectionAt + correctionIntervalHours, endHour)
            let mid = startMs + (nextCorrectionAt + chunkEnd) / 2 * 3.6e6
            params = Self.prepare(constituents, baseAstro, catalog, Date(timeIntervalSince1970: mid / 1000))
            nextCorrectionAt += correctionIntervalHours
            generation += 1
        }
        return params
    }

    private static func prepare(_ constituents: [StationConstituent], _ baseAstro: Astro,
                                _ catalog: Catalog, _ correctionTime: Date) -> [PreparedParam] {
        let ca = astro(correctionTime)
        var out: [PreparedParam] = []
        for c in constituents where c.amplitude != 0 {
            guard let speed = catalog.speed(c.name) else { continue }
            let V0 = d2r * catalog.v0(c.name, baseAstro)
            let corr = catalog.correction(c.name, ca)
            out.append(PreparedParam(A: c.amplitude * corr.f, w: d2r * speed, phi: V0 + d2r * corr.u - c.phase))
        }
        return out
    }
}

/// Timeline of sample instants (Slackwater getTimeline): start floored, end ceiled to `step`.
struct Timeline { let items: [Date]; let hours: [Double]; let startMs: Double; let endHour: Double }

func makeTimeline(from: Date, to: Date, step: TimeInterval) -> Timeline {
    let s = step
    let startSec = (from.timeIntervalSince1970 / s).rounded(.down) * s
    let endSec = (to.timeIntervalSince1970 / s).rounded(.up) * s
    var items: [Date] = []
    var hours: [Double] = []
    var t = startSec
    while t <= endSec {
        items.append(Date(timeIntervalSince1970: t))
        hours.append((t - startSec) / 3600)
        t += s
    }
    return Timeline(items: items, hours: hours, startMs: startSec * 1000, endHour: (endSec - startSec) / 3600)
}
