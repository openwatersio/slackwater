package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*

internal fun direction(value: Double?): Double? {
    require(value == null || value.isFinite()) { "Direction must be finite or null" }
    return value?.let(::wrap)
}

internal fun axialDirection(speed: Double, flood: Double?, ebb: Double?): Double? =
    if (speed > 0) flood else if (speed < 0) ebb else null

/** Signed major-axis velocity in knots: positive flood, negative ebb. Directions are true degrees. */
class CurrentStation @JvmOverloads constructor(
    constituents: List<HarmonicConstituent>,
    floodDirectionDegrees: Double? = null,
    ebbDirectionDegrees: Double? = null,
    val offsetKnots: Double = 0.0,
    minorConstituents: List<HarmonicConstituent>? = null,
    minorOffsetKnots: Double = 0.0,
    azimuthDegrees: Double? = null
) {
    private val harmonic = Station(constituents, offsetKnots)
    private val minor = if (minorOffsetKnots != 0.0 || minorConstituents.orEmpty().any { it.amplitude != 0.0 && Catalog.speed(it.name) != null })
        Station(minorConstituents.orEmpty(), minorOffsetKnots) else null
    val floodDirectionDegrees = direction(floodDirectionDegrees)
    val ebbDirectionDegrees = direction(ebbDirectionDegrees)
    private val azimuth = direction(azimuthDegrees) ?: this.floodDirectionDegrees
    internal val phaseSearchLimitSeconds = harmonic.phaseSearchLimitSeconds

    fun speeds(from: Instant, to: Instant, stepSeconds: Double = 600.0): List<CurrentPoint> {
        val major = harmonic.heights(from, to, stepSeconds)
        val cross = minor?.heights(from, to, stepSeconds)
        return major.mapIndexed { index, point ->
            val speed = point.heightMetres
            if (cross == null) CurrentPoint(point.time, speed,
                directionDegrees = axialDirection(speed, floodDirectionDegrees, ebbDirectionDegrees))
            else {
                val v = cross[index].heightMetres
                val magnitude = hypot(speed, v)
                // NOAA's positive minor axis is clockwise from the major axis (https://tidesandcurrents.noaa.gov/publications/techrpt21.pdf, p. 37).
                val bearing = if (magnitude == 0.0 || azimuth == null) null else wrap(azimuth + atan2(v, speed) / D2R)
                CurrentPoint(point.time, speed, magnitude, bearing)
            }
        }
    }
    fun slacks(from: Instant, to: Instant) = events(from, to).filter { it.kind == CurrentEventKind.SLACK }
    fun maxima(from: Instant, to: Instant) = events(from, to).filter { it.kind != CurrentEventKind.SLACK }

    // Whole UTC days keep event filtering independent of the caller's window (packages/engine/src/currents.ts).
    fun events(from: Instant, to: Instant): List<CurrentEvent> {
        if (to < from) return emptyList()
        val first = floor(epochSeconds(from) / 86400).toLong()
        val last = floor(epochSeconds(to) / 86400).toLong()
        require(last - first < Int.MAX_VALUE) { "Event window exceeds indexed range" }
        val bracket = harmonic.eventBracketHours
        if (!bracket.isFinite()) return emptyList()
        checkEventCapacity((last - first + 1 + 2 * (MAX_CONTEXT_DAYS + 1)) * 40.0, bracket)
        val results = mutableListOf<CurrentEvent>()
        for (day in first..last) {
            val begin = instant(day * 86400.0)
            val end = begin.plusSeconds(86400)
            results += inWindow(begin.minusSeconds(8 * 3600), end.plusSeconds(8 * 3600))
                .filter { it.time >= begin && it.time < end && it.time >= from && it.time <= to }
        }
        return results.sortedBy { it.time }.distinctBy { it.time to it.kind }
    }
    private fun inWindow(from: Instant, to: Instant): List<CurrentEvent> {
        val start = instant(floor(epochSeconds(from) / 600) * 600)
        val endHour = (ceil(epochSeconds(to) / 600) * 600 - epochSeconds(start)) / 3600
        fun provider() = ParamProvider(harmonic.constituents, offsetKnots, start, endHour)
        val end = shifted(start, endHour * 3600)
        val maxima = findExtremes(start, end, 0.01) { day -> ParamProvider(harmonic.constituents, offsetKnots, day, 24.0) }.map {
            val flood = it.level >= 0
            CurrentEvent(it.time, it.level, if (flood) CurrentEventKind.MAX_FLOOD else CurrentEventKind.MAX_EBB,
                if (flood) floodDirectionDegrees else ebbDirectionDegrees)
        }
        return maxima + findSlacks(endHour, provider())
    }
}

internal fun findSlacks(toHour: Double, provider: ParamProvider): List<CurrentEvent> {
    var params = provider.params(0.0)
    var generation = provider.generation
    val maxSpeed = params.maxOfOrNull { it.speedRadiansPerHour } ?: return emptyList()
    if (maxSpeed <= 0) return emptyList()
    val bracket = PI / (2 * maxSpeed)
    checkEventCapacity(toHour, bracket)
    val results = mutableListOf<CurrentEvent>()
    var previous = 0.0
    var vPrevious = evalH(previous, params)
    var next = previous + bracket
    while (next <= toHour + bracket) {
        val fresh = provider.params(previous)
        if (provider.generation != generation) {
            params = fresh; generation = provider.generation
            vPrevious = evalH(previous, params)
        }
        val bound = min(next, toHour)
        val value = evalH(bound, params)
        if (vPrevious != 0.0 && value != 0.0 && (vPrevious > 0) != (value > 0)) {
            val root = bisectZero(previous, bound, vPrevious, params, ::evalH)
            results += CurrentEvent(shifted(provider.start, root * 3600), evalH(root, params), CurrentEventKind.SLACK)
        }
        if (bound >= toHour) break
        previous = bound; vPrevious = value; next += bracket
    }
    return results
}
