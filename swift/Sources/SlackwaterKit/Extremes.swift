// Slackwater — MIT. Tidal extremes (high/low) finder.
// Faithful port of @slackwater/engine src/harmonics/extremes.ts findExtremes:
// bracket zeros of h'(t) in whole UTC days, bisect to sub-second, classify via
// h''(t), then keep the extremes that persist and crop to the window.
import Foundation

private let toleranceHours = 1.0 / 3600  // 1 second
/// The furthest the filter looks from an extreme for what decides it: past the
/// fortnightly (MSf, 14.8 d) and monthly (MM, 27.6 d) cycles that set the
/// extremes of a tide whose daily turns are all below the threshold.
private let maxContextDays = 32.0
/// How far the search goes for an extreme's nearest turn, however far away:
/// past a year, so a tide made of the annual and semiannual cycles alone still
/// has its neighbours.
private let maxLookaheadDays = 400.0
private let daySeconds = 86_400.0

struct RawExtreme { let time: Date; let level: Double; let high: Bool }

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

/// Extremes in [from, to]. Turning points are the roots of h'(t), found in
/// whole UTC days, each day searched from its own midnight with its own
/// brackets and node corrections (`provider(day)`), so the turning points of any
/// instant are the same whichever window asks. Each day's first bracket opens
/// on the previous day's h' at midnight, so a turn the two days' parameters put
/// on either side of midnight is found once. Spurious ones are removed by
/// their persistence (see `persists`), judged from the turning points around
/// each extreme, never the window's edges. Days beyond the window are searched
/// only while an extreme is undecided. The extremes of any window are therefore
/// exactly the extremes of a longer window that fall inside it
/// (slackwater#436). A threshold of zero keeps every turning point.
func findExtremes(from: Date, to: Date, prominenceThreshold: Double,
                  provider: (Date) -> ParamProvider) -> [RawExtreme] {
    let fromS = from.timeIntervalSince1970, toS = to.timeIntervalSince1970
    guard toS >= fromS else { return [] }
    let firstDay = (fromS / daySeconds).rounded(.down)
    let lastSearchDay = (toS / daySeconds).rounded(.down) + maxLookaheadDays
    let firstSearchDay = firstDay - maxLookaheadDays
    // Z0 alone has no turning points on any day; don't search a year of days to find that out.
    // Each day keeps only its h' at midnight, for the day after it, and the
    // last parameters built are kept for the day that needs them next.
    var closingSlopes: [Double: Double] = [:]
    var lastDay = Double.nan
    var lastParams: [PreparedParam] = []
    func params(_ day: Double) -> [PreparedParam] {
        if day != lastDay {
            lastParams = provider(Date(timeIntervalSince1970: day * daySeconds))(0)
            lastDay = day
            closingSlopes[day] = evalHPrime(24, lastParams)
        }
        return lastParams
    }
    func closingSlope(_ day: Double) -> Double {
        if closingSlopes[day] == nil { _ = params(day) }
        return closingSlopes[day]!
    }
    guard params(firstDay).contains(where: { $0.w > 0 }) else { return [] }
    // The day's own parameters come first, so the day before's, built for its
    // closing slope, are still kept when a backward scan reaches it next.
    func dayTurns(_ day: Double) -> [RawExtreme] {
        let own = params(day)
        return turningPoints(dayStart: day * daySeconds, params: own, openingSlope: closingSlope(day - 1))
    }

    // Turning points as one sequence indexed from the first turn of firstDay:
    // `after` holds index 0 onward, `before` holds index -1 backward. Days are
    // added at either end as a scan reaches them.
    var after: [RawExtreme] = [], before: [RawExtreme] = []
    var nextDay = firstDay, prevDay = firstDay - 1
    func turn(_ k: Int) -> RawExtreme? {
        if k >= 0 {
            while after.count <= k && nextDay <= lastSearchDay { after += dayTurns(nextDay); nextDay += 1 }
            return k < after.count ? after[k] : nil
        }
        while before.count < -k && prevDay >= firstSearchDay { before += dayTurns(prevDay).reversed(); prevDay -= 1 }
        return -k <= before.count ? before[-k - 1] : nil
    }

    var results: [RawExtreme] = []
    var k = 0
    while let extreme = turn(k), extreme.time.timeIntervalSince1970 <= toS {
        // A threshold of zero keeps every turning point, unfiltered.
        if extreme.time.timeIntervalSince1970 >= fromS
            && (prominenceThreshold <= 0 || persists(turn, k, prominenceThreshold)) {
            results.append(extreme)
        }
        k += 1
    }
    return results
}

/// Every root of h'(t) in the UTC day starting at `dayStart` (epoch seconds),
/// with `params` anchored at its midnight. Node corrections refresh every 24
/// hours, so one set holds for the whole day. Brackets are a quarter period of
/// the fastest constituent, within which h' is taken to change sign at most
/// once; a root exactly on a bracket boundary is not guaranteed. The first
/// bracket opens on `openingSlope`, the previous day's h' at midnight, so a
/// sign change between the two days' parameters is a turn at midnight, and a
/// turn the previous day already found just before midnight is not found again.
private func turningPoints(dayStart: Double, params: [PreparedParam], openingSlope: Double) -> [RawExtreme] {
    var maxSpeed = 0.0
    for p in params where p.w > maxSpeed { maxSpeed = p.w }
    if maxSpeed == 0 { return [] }

    let bracket = Double.pi / (2 * maxSpeed)
    var results: [RawExtreme] = []
    var tPrev = 0.0
    var dPrev = openingSlope
    var tNext = bracket
    while true {
        let tBound = min(tNext, 24)
        let dNext = evalHPrime(tBound, params)
        if dPrev != 0 && dNext != 0 && (dPrev > 0 ? dNext < 0 : dNext > 0) {
            // The sign changed inside this day, so the root is this day's: the next
            // day opens on the slope after it and won't find it again.
            let tRoot = bisect(tPrev, tBound, dPrev, params)
            let isHigh = evalHDoublePrime(tRoot, params) < 0
            results.append(RawExtreme(time: Date(timeIntervalSince1970: dayStart + tRoot * 3600),
                                      level: evalH(tRoot, params), high: isHigh))
        }
        if tBound >= 24 { break }
        tPrev = tBound
        dPrev = dNext
        tNext += bracket
    }
    return results
}

/// Whether the extreme at index k persists: a high survives when, in each
/// direction, the tide falls at least `prominenceThreshold` (metres) below it
/// before rising above it; a low, mirrored. Away from a list's ends and exact
/// ties, that keeps what removing the closest high-low pair below the threshold,
/// smallest first, keeps, as NOAA
/// CO-OPS drops successive high and low tides closer than its 0.030 m (Water
/// Level Station Specifications, 2009, §1.3.2), but each extreme is decided
/// from its own neighbourhood, so the result does not depend on where a search
/// starts or ends. Of two equal turns in a row one survives.
///
/// The nearest turn on each side always counts, however far away. Past it, the
/// scan stops `maxContextDays` from the extreme, and an extreme still undecided
/// there, or at the end of the sequence, is dropped. Where every turn for more
/// than `maxContextDays` is below the threshold, that can drop one extreme of a
/// high-low pair and leave two of a kind in a row.
private func persists(_ turn: (Int) -> RawExtreme?, _ k: Int, _ prominenceThreshold: Double) -> Bool {
    let extreme = turn(k)!
    let sign = extreme.high ? 1.0 : -1.0
    let h = extreme.level * sign
    let t = extreme.time.timeIntervalSince1970
    for dir in [-1, 1] {
        var decided = false
        var j = k + dir
        // The nearest turn counts up to `maxLookaheadDays` away; past it the scan stops
        // `maxContextDays` from the extreme. Both are measured from the extreme, never the window.
        while let other = turn(j),
              abs(other.time.timeIntervalSince1970 - t) <= (j == k + dir ? maxLookaheadDays : maxContextDays) * daySeconds {
            let v = other.level * sign
            // An equal turn counts as higher on the left only, so one of two equal copies survives.
            if dir < 0 ? v >= h : v > h { break }
            if h - v >= prominenceThreshold { decided = true; break }
            j += dir
        }
        if !decided { return false }
    }
    return true
}

/// The extremes of a list that persist (see `persists`), judged within the list.
func filterExtremes(_ extremes: [RawExtreme], prominenceThreshold: Double) -> [RawExtreme] {
    let turn = { (k: Int) in extremes.indices.contains(k) ? extremes[k] : nil }
    return extremes.indices.filter { persists(turn, $0, prominenceThreshold) }.map { extremes[$0] }
}

extension Station {
    /// High/low extremes between `from` and `to`, fully offline.
    public func extremes(from: Date, to: Date) -> [TideExtreme] {
        // hatyan calc_HWLW's minimum prominence, the TypeScript default.
        extremes(from: from, to: to, prominenceThreshold: 0.01)
    }

    func extremes(from: Date, to: Date, prominenceThreshold: Double) -> [TideExtreme] {
        computeExtremes(from: from, to: to, prominenceThreshold: prominenceThreshold)
            .map { TideExtreme(time: $0.time, height: $0.level, kind: $0.high ? .high : .low) }
    }

    private func computeExtremes(from: Date, to: Date, prominenceThreshold: Double) -> [RawExtreme] {
        // Same floor/ceil-to-step bounds as makeTimeline, without materializing the samples.
        let step = 600.0
        let startSec = (from.timeIntervalSince1970 / step).rounded(.down) * step
        let endSec = (to.timeIntervalSince1970 / step).rounded(.up) * step
        return findExtremes(from: Date(timeIntervalSince1970: startSec), to: Date(timeIntervalSince1970: endSec),
                            prominenceThreshold: prominenceThreshold) { day in
            ParamProvider(constituents: constituents, baseAstro: astro(day), catalog: catalog,
                          startMs: day.timeIntervalSince1970 * 1000, endHour: 24)
        }
    }
}
