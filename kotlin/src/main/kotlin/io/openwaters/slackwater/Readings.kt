package io.openwaters.slackwater

import java.time.Duration
import java.time.Instant
import kotlin.math.*

// What the water is doing at an instant, read from a sampled series and its events.
// Mirrors packages/engine/src/readings/{series,current,tide}.ts and swift/Sources/SlackwaterKit/Readings.swift.

private fun nanosBetween(a: Instant, b: Instant): Double = Duration.between(a, b).toNanos().toDouble()

/** The indices of the samples bracketing `time`: the last at or before it and the one after; null outside the samples. */
private fun <T> List<T>.bracket(time: Instant, instant: (T) -> Instant): Pair<Int, Int>? {
    var lo = 0
    var hi = size - 1
    if (hi < 0 || time < instant(this[0]) || time > instant(this[hi])) return null
    while (hi - lo > 1) {
        val mid = (lo + hi) / 2
        if (instant(this[mid]) <= time) lo = mid else hi = mid
    }
    return lo to hi
}

/** `value` at `time`, linearly interpolated between sorted samples; null outside them. */
private fun <T> List<T>.interpolate(time: Instant, instant: (T) -> Instant, value: (T) -> Double): Double? {
    val (lo, hi) = bracket(time, instant) ?: return null
    val a = this[lo]
    val b = this[hi]
    val span = nanosBetween(instant(a), instant(b))
    return if (span == 0.0) value(a) else value(a) + (value(b) - value(a)) * nanosBetween(instant(a), time) / span
}

/** Whether two instants fall within one second, counted in whole milliseconds as the TypeScript engine's dates are. */
private fun withinOneSecond(a: Instant, b: Instant): Boolean = Duration.between(a, b).abs().toMillis() <= 1000

/** `a`'s instant moved `fraction` of the way to `b`'s, to the nanosecond. */
private fun between(a: Instant, b: Instant, fraction: Double): Instant = a.plusNanos((nanosBetween(a, b) * fraction).roundToLong())

/** Height at `time`, linearly interpolated; null outside the series. */
fun List<TidePoint>.heightAt(time: Instant): Double? = interpolate(time, { it.time }, { it.heightMetres })

/**
 * The rate of rise at each sample in metres per hour, by central differences, one-sided at the ends.
 * Sampled from the series, where `Station.rates` is the analytic derivative.
 */
fun List<TidePoint>.sampledRates(): List<TideRatePoint> = indices.map { i ->
    val a = this[max(0, i - 1)]
    val b = this[min(size - 1, i + 1)]
    val hours = nanosBetween(a.time, b.time) / 3.6e12
    TideRatePoint(this[i].time, if (hours > 0) (b.heightMetres - a.heightMetres) / hours else 0.0)
}

/** The lowest and highest height in metres. */
data class HeightRange(val minMetres: Double, val maxMetres: Double)

/** The lowest and highest sample in `[from, to]`; null when none falls inside it. */
fun List<TidePoint>.heightRange(from: Instant, to: Instant): HeightRange? {
    var low = Double.POSITIVE_INFINITY
    var high = Double.NEGATIVE_INFINITY
    for (p in this) {
        if (p.time < from || p.time > to) continue
        if (p.heightMetres < low) low = p.heightMetres
        if (p.heightMetres > high) high = p.heightMetres
    }
    return if (low <= high) HeightRange(low, high) else null
}

/** Signed rate of rise at `time`, linearly interpolated; null outside the samples. */
fun List<TideRatePoint>.rateAt(time: Instant): Double? = interpolate(time, { it.time }, { it.rateMetresPerHour })

/** Signed speed at `time`, linearly interpolated; null outside the series. */
fun List<CurrentPoint>.speedAt(time: Instant): Double? = interpolate(time, { it.time }, { it.speedKnots })

/** The full current vector at an instant. */
data class CurrentVector(
    val magnitudeKnots: Double,
    /** Predicted set in degrees true; null at zero speed or when unknown. */
    val directionDegrees: Double?,
)

/**
 * The magnitude a reading may trust, or null for a one-axis sample whose set comes from the published bearings.
 * A zero sample is a zero vector either way, and reads as one so a vector series can turn through it.
 */
private val CurrentPoint.knownMagnitude: Double?
    get() = if (directionDegrees == null && magnitudeKnots == abs(speedKnots) && magnitudeKnots != 0.0) null else magnitudeKnots

private fun vector(magnitude: Double, direction: Double?) = CurrentVector(magnitude, if (magnitude > 1e-9) direction else null)

/**
 * The current vector at `time`, interpolated through bearings; null outside the series. A sample with no direction
 * and a magnitude of `abs(speedKnots)` is one-axis and takes the flood or ebb bearing by its sign.
 */
fun List<CurrentPoint>.vectorAt(time: Instant, floodDirectionDegrees: Double?, ebbDirectionDegrees: Double?): CurrentVector? {
    val speed = speedAt(time) ?: return null
    val (lo, hi) = bracket(time) { it.time } ?: return null
    val a = this[lo]
    val b = this[hi]
    val span = nanosBetween(a.time, b.time)
    val mix = if (span == 0.0) 0.0 else nanosBetween(a.time, time) / span
    val phase = if (speed >= 0) floodDirectionDegrees else ebbDirectionDegrees
    if (mix == 0.0 || mix == 1.0) {
        val p = if (mix == 0.0) a else b
        val magnitude = p.knownMagnitude ?: return vector(abs(speed), phase)
        return vector(magnitude, p.directionDegrees)
    }
    // Scalar phase bearings need not be reciprocal; their reversal must not synthesize crossflow.
    val axialReversal = a.knownMagnitude == abs(a.speedKnots) && b.knownMagnitude == abs(b.speedKnots) &&
        a.speedKnots * b.speedKnots < 0
    val am = a.knownMagnitude
    val bm = b.knownMagnitude
    if (am == null || bm == null || axialReversal) {
        val direction = if (axialReversal) (if ((speed >= 0) == (a.speedKnots >= 0)) a else b).directionDegrees else phase
        return vector(abs(speed), direction)
    }
    if ((am != 0.0 && a.directionDegrees == null) || (bm != 0.0 && b.directionDegrees == null)) {
        return CurrentVector(am + (bm - am) * mix, null)
    }
    // Interpolate vectors so north crossings and opposing flows retain their physical meaning.
    val radians = PI / 180
    val ad = (a.directionDegrees ?: 0.0) * radians
    val bd = (b.directionDegrees ?: 0.0) * radians
    val x = am * sin(ad) * (1 - mix) + bm * sin(bd) * mix
    val y = am * cos(ad) * (1 - mix) + bm * cos(bd) * mix
    return vector(hypot(x, y), (atan2(x, y) / radians % 360 + 360) % 360)
}

/** The phase of the tide a current reading falls in. */
enum class CurrentState { SLACK, MAX_FLOOD, MAX_EBB, FLOODING, EBBING }

/** The lead reading at an instant: phase, signed major-axis speed, and the full vector. */
data class CurrentReading(
    val state: CurrentState,
    val speedKnots: Double,
    val magnitudeKnots: Double,
    /** Predicted set in degrees true; null at zero speed or when unknown. */
    val directionDegrees: Double?,
)

/** The lead reading at `time`: slack or max within a second of an event, otherwise the flooding or ebbing phase. */
fun readCurrent(time: Instant, timeline: List<CurrentPoint>, events: List<CurrentEvent>,
    floodDirectionDegrees: Double?, ebbDirectionDegrees: Double?): CurrentReading? {
    val speed = timeline.speedAt(time) ?: return null
    val vector = timeline.vectorAt(time, floodDirectionDegrees, ebbDirectionDegrees) ?: return null
    val max = events.firstOrNull { it.kind != CurrentEventKind.SLACK && withinOneSecond(it.time, time) }
    val state = when {
        events.any { it.kind == CurrentEventKind.SLACK && withinOneSecond(it.time, time) } -> CurrentState.SLACK
        max != null -> if (max.kind == CurrentEventKind.MAX_FLOOD) CurrentState.MAX_FLOOD else CurrentState.MAX_EBB
        speed >= 0 -> CurrentState.FLOODING
        else -> CurrentState.EBBING
    }
    return CurrentReading(state, speed, vector.magnitudeKnots, vector.directionDegrees)
}

/** The 16 compass points as abbreviations, clockwise from north. */
val COMPASS_POINTS: List<String> = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ")

/** The 16 compass points as spoken words, in the order of [COMPASS_POINTS]. */
val SPOKEN_COMPASS_POINTS: List<String> = listOf(
    "north", "north-northeast", "northeast", "east-northeast",
    "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest",
    "west", "west-northwest", "northwest", "north-northwest",
)

/** The index into the compass point lists nearest a bearing in degrees; a non-finite bearing reads as north. */
fun compassIndex(degrees: Double): Int {
    if (!degrees.isFinite()) return 0
    // Rounds halves up, as JavaScript's Math.round does, so a bearing reads the same on every platform.
    val x = degrees % 360 / 22.5
    val whole = floor(x)
    val nearest = (if (x - whole >= 0.5) whole + 1 else whole).toInt()
    return (nearest % 16 + 16) % 16
}

/** A bearing in degrees true as a 16-point compass abbreviation. */
fun compassPoint(degrees: Double): String = COMPASS_POINTS[compassIndex(degrees)]

/** One kind's maxima as unsigned speeds, so floods rank against floods and ebbs against ebbs. */
fun List<CurrentEvent>.maxSpeeds(kind: CurrentEventKind): List<Double> = filter { it.kind == kind }.map { abs(it.speedKnots) }

/** The default major-axis speed threshold for slack windows, in knots. */
const val DEFAULT_SLACK_THRESHOLD_KNOTS = 0.5

/** A span of workable water around one or more slacks. */
data class SlackWindow(val start: Instant, val end: Instant)

/**
 * Where the straight line between one sample inside the ±`threshold` band and one outside it crosses the band's edge.
 * Signed, so a pair either side of a reversal crosses on the outside sample's side rather than at a mirrored speed.
 */
private fun bandCrossing(a: CurrentPoint, b: CurrentPoint, threshold: Double): Instant {
    val outside = if (abs(a.speedKnots) > threshold) a.speedKnots else b.speedKnots
    val edge = if (outside > 0) threshold else -threshold
    return between(a.time, b.time, (edge - a.speedKnots) / (b.speedKnots - a.speedKnots))
}

/**
 * The workable window around a slack: where |speed| stays within `thresholdKnots`, clamped to the series and widened
 * to hold the slack. Null for a slack outside the series, between two out-of-band samples of one sign, or at a
 * threshold at or below zero.
 */
fun slackWindowAround(points: List<CurrentPoint>, slack: Instant, thresholdKnots: Double): SlackWindow? {
    val n = points.size
    if (thresholdKnots <= 0 || n == 0 || slack < points[0].time || slack > points[n - 1].time) return null
    fun inBand(i: Int) = abs(points[i].speedKnots) <= thresholdKnots
    val i = points.indexOfLast { it.time <= slack }
    val k = when {
        inBand(i) -> i
        i + 1 < n && inBand(i + 1) -> i + 1
        i + 1 < n && (points[i].speedKnots > 0) != (points[i + 1].speedKnots > 0) -> {
            // A reversal between two out-of-band samples crosses the band along the straight segment of absolute speed.
            val a = abs(points[i].speedKnots)
            val span = a + abs(points[i + 1].speedKnots)
            return SlackWindow(minOf(slack, between(points[i].time, points[i + 1].time, (a - thresholdKnots) / span)),
                maxOf(slack, between(points[i].time, points[i + 1].time, (a + thresholdKnots) / span)))
        }
        else -> return null
    }
    var lo = k
    while (lo > 0 && inBand(lo - 1)) lo--
    var hi = k
    while (hi < n - 1 && inBand(hi + 1)) hi++
    val start = if (lo > 0) bandCrossing(points[lo - 1], points[lo], thresholdKnots) else points[0].time
    val end = if (hi < n - 1) bandCrossing(points[hi], points[hi + 1], thresholdKnots) else points[n - 1].time
    return SlackWindow(minOf(slack, start), maxOf(slack, end))
}

/** Windows in chronological order merged into runs: a window joins the run before it when it starts at or before that run ends. */
fun mergeWindows(windows: List<SlackWindow>): List<SlackWindow> {
    val runs = mutableListOf<SlackWindow>()
    for (w in windows) {
        val last = runs.lastOrNull()
        if (last != null && w.start <= last.end) runs[runs.size - 1] = SlackWindow(last.start, maxOf(last.end, w.end))
        else runs.add(w)
    }
    return runs
}

/** The windows around the slacks inside the series merged into runs; a slack with no window stays an exact instant. */
fun slackRuns(points: List<CurrentPoint>, events: List<CurrentEvent>, thresholdKnots: Double): List<SlackWindow> {
    val first = points.firstOrNull()?.time ?: return emptyList()
    val last = points.last().time
    return mergeWindows(events
        .filter { it.kind == CurrentEventKind.SLACK && it.time >= first && it.time <= last }
        .map { slackWindowAround(points, it.time, thresholdKnots) ?: SlackWindow(it.time, it.time) }
        .sortedBy { it.start })
}

/** Each rising or falling run's fastest sample, when it reaches `floorMetresPerHour`; a still sample ends a run. */
fun flowPeaks(rates: List<TideRatePoint>, floorMetresPerHour: Double): List<TideRatePoint> {
    val peaks = mutableListOf<TideRatePoint>()
    val run = mutableListOf<TideRatePoint>()
    var direction = 0.0
    fun finish() {
        var peak: TideRatePoint? = null
        for (p in run) if (peak == null || abs(p.rateMetresPerHour) > abs(peak.rateMetresPerHour)) peak = p
        if (peak != null && abs(peak.rateMetresPerHour) >= floorMetresPerHour) peaks.add(peak)
        run.clear()
    }
    for (p in rates) {
        if (abs(p.rateMetresPerHour) < 0.0001) {
            finish()
            direction = 0.0
            continue
        }
        val next = sign(p.rateMetresPerHour)
        if (direction != 0.0 && next != direction) finish()
        direction = next
        run.add(p)
    }
    finish()
    return peaks
}

/** The phase of the tide a reading falls in. */
enum class TideState { HIGH, LOW, RISING, FALLING }

/** The lead reading at an instant: phase, height in metres, direction and signed rate in metres per hour. */
data class TideReading(
    val state: TideState,
    val heightMetres: Double,
    /** High or rising, rather than low or falling. */
    val rising: Boolean,
    val rateMetresPerHour: Double,
)

/**
 * The lead reading at `time`: high or low within a second of a turn, at the turn's own height; otherwise rising
 * toward a high or falling toward a low, by the sampled rate when no later turn is loaded. Null outside the samples.
 */
fun readTide(time: Instant, heights: List<TidePoint>, rates: List<TideRatePoint>, extremes: List<TideExtreme>): TideReading? {
    val height = heights.heightAt(time) ?: return null
    val rate = rates.rateAt(time) ?: return null
    val turn = extremes.firstOrNull { withinOneSecond(it.time, time) }
    if (turn != null) {
        val high = turn.kind == ExtremeKind.HIGH
        return TideReading(if (high) TideState.HIGH else TideState.LOW, turn.heightMetres, high, rate)
    }
    val rising = extremes.firstOrNull { it.time > time }?.let { it.kind == ExtremeKind.HIGH } ?: (rate >= 0)
    return TideReading(if (rising) TideState.RISING else TideState.FALLING, height, rising, rate)
}

/** Where `value` sits among these values, 0 to 1, ties counting as below; null when there are none. */
fun List<Double>.percentileRank(value: Double): Double? =
    if (isEmpty()) null else count { it <= value }.toDouble() / size

/**
 * The height of every rise and fall between adjacent opposite turns. A run of same-kind turns keeps its lower low
 * or higher high; a pair whose high is at or below its low is no swing.
 */
fun List<TideExtreme>.swingHeights(): List<Double> {
    val out = mutableListOf<Double>()
    var prev = firstOrNull() ?: return out
    for (e in drop(1)) {
        if (e.kind == prev.kind) {
            // Two lows in a row mean the high between them is missing, so the swing starts from the lower.
            if ((e.kind == ExtremeKind.LOW) == (e.heightMetres < prev.heightMetres)) prev = e
            continue
        }
        val (low, high) = if (prev.kind == ExtremeKind.HIGH) e to prev else prev to e
        prev = e
        // A subordinate's separate high and low offsets can invert a pair, which is no swing at all.
        if (high.heightMetres > low.heightMetres) out.add(high.heightMetres - low.heightMetres)
    }
    return out
}
