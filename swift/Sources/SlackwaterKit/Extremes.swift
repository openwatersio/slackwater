// Slackwater — MIT. Tidal extremes (high/low) finder.
// Faithful port of @slackwater/engine src/harmonics/extremes.ts findExtremes:
// bracket zeros of h'(t), bisect to sub-second, classify via h''(t), then filter
// spurious extremes by prominence.
import Foundation

private let toleranceHours = 1.0 / 3600  // 1 second

struct RawExtreme { let hour: Double; let time: Date; let level: Double; let high: Bool }

/// Root of h'(t) in [a, b] where h'(a), h'(b) have opposite signs. Bisection.
private func bisect(_ a0: Double, _ b0: Double, _ fa0: Double, _ params: [PreparedParam]) -> Double {
    var a = a0, b = b0, fa = fa0
    while true {
        let mid = (a + b) / 2
        if b - a < toleranceHours { return mid }
        let fMid = evalHPrime(mid, params)
        if fMid == 0 { return mid }
        if fa > 0 ? fMid > 0 : fMid < 0 { a = mid; fa = fMid } else { b = mid }
    }
}

func findExtremes(fromHour: Double, toHour: Double, provider: ParamProvider,
                  prominenceThreshold: Double) -> [RawExtreme] {
    var params = provider(max(0, fromHour))
    var lastGen = provider.generation
    if params.isEmpty { return [] }

    var maxSpeed = 0.0
    for p in params where p.w > maxSpeed { maxSpeed = p.w }
    if maxSpeed == 0 { return [] }

    let bracket = Double.pi / (2 * maxSpeed)

    var results: [RawExtreme] = []
    var tPrev = fromHour
    var dPrev = evalHPrime(tPrev, params)
    var tNext = tPrev + bracket
    while tNext <= toHour + bracket {
        let newParams = provider(tPrev)
        if provider.generation != lastGen { params = newParams; lastGen = provider.generation; dPrev = evalHPrime(tPrev, params) }
        let tBound = min(tNext, toHour)
        let dNext = evalHPrime(tBound, params)
        if dPrev != 0 && dNext != 0 && (dPrev > 0 ? dNext < 0 : dNext > 0) {
            let tRoot = bisect(tPrev, tBound, dPrev, params)
            if tRoot >= fromHour && tRoot <= toHour {
                let isHigh = evalHDoublePrime(tRoot, params) < 0
                results.append(RawExtreme(hour: tRoot,
                                          time: Date(timeIntervalSince1970: provider.startMs / 1000 + tRoot * 3600),
                                          level: evalH(tRoot, params), high: isHigh))
            }
        }
        if tBound >= toHour { break }
        tPrev = tBound
        dPrev = dNext
        tNext += bracket
    }

    return filterExtremes(results, prominenceThreshold: prominenceThreshold)
}

/// Remove spurious extremes, smallest first: while two neighbours differ by less
/// than `prominenceThreshold` (metres), drop both, as NOAA CO-OPS drops successive
/// high and low tides closer than its 0.030 m (Water Level Station Specifications,
/// 2009, §1.3.2). Removing a low together with its high keeps highs and lows
/// alternating. Two or fewer extremes are returned as they are.
func filterExtremes(_ extremes: [RawExtreme], prominenceThreshold: Double) -> [RawExtreme] {
    var kept = extremes
    func change(_ i: Int) -> Double { abs(kept[i + 1].level - kept[i].level) }
    // ponytail: O(n²) rescan per removal; a heap keyed on change() if long sub-threshold spans get slow
    while kept.count > 2 {
        var worst = 0
        for i in 1..<(kept.count - 1) where change(i) < change(worst) { worst = i }
        if change(worst) >= prominenceThreshold { break }
        // Same-kind neighbours are one turn counted twice by the root finder; drop one copy.
        let count = kept[worst].high == kept[worst + 1].high ? 1 : 2
        kept.removeSubrange(worst..<(worst + count))
    }
    return kept
}

extension Station {
    /// High/low extremes between `from` and `to`, fully offline.
    public func extremes(from: Date, to: Date) -> [TideExtreme] {
        let raw = computeExtremes(from: from, to: to)
        return raw.map { TideExtreme(time: $0.time, height: $0.level, kind: $0.high ? .high : .low) }
    }

    private func computeExtremes(from: Date, to: Date) -> [RawExtreme] {
        // Same floor/ceil-to-step bounds as makeTimeline, without materializing the samples.
        let step = 600.0
        let startSec = (from.timeIntervalSince1970 / step).rounded(.down) * step
        let endSec = (to.timeIntervalSince1970 / step).rounded(.up) * step
        guard endSec >= startSec else { return [] }
        let endHour = (endSec - startSec) / 3600
        let base = astro(Date(timeIntervalSince1970: startSec))
        let provider = ParamProvider(constituents: constituents, baseAstro: base, catalog: catalog,
                                     startMs: startSec * 1000, endHour: endHour)
        // hatyan calc_HWLW's minimum prominence, the TypeScript default.
        return findExtremes(fromHour: 0, toHour: endHour, provider: provider, prominenceThreshold: 0.01)
    }
}
