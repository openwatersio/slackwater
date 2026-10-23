package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*

internal fun epochSeconds(time: Instant): Double {
    require(abs(time.epochSecond.toDouble()) < 9007199254740992.0) { "Instant exceeds exact epoch-second range" }
    return time.epochSecond.toDouble() + time.nano / 1e9
}
internal fun instant(seconds: Double): Instant {
    require(seconds.isFinite() && abs(seconds) < 9007199254740992.0) { "Unrepresentable epoch time" }
    val whole = floor(seconds)
    return Instant.ofEpochSecond(whole.toLong(), ((seconds - whole) * 1e9).roundToLong())
}
internal fun shifted(time: Instant, seconds: Double) = instant(epochSeconds(time) + seconds)
internal data class Timeline(val items: List<Instant>, val hours: List<Double>, val start: Instant, val endHour: Double)
internal fun makeTimeline(from: Instant, to: Instant, stepSeconds: Double): Timeline {
    require(stepSeconds.isFinite() && stepSeconds >= 1e-9) { "Step must be finite and at least one nanosecond" }
    if (to < from) return Timeline(emptyList(), emptyList(), from, 0.0)
    val first = epochSeconds(from)
    val last = epochSeconds(to)
    var start = floor(first / stepSeconds) * stepSeconds
    var end = ceil(last / stepSeconds) * stepSeconds
    require(stepSeconds >= max(Math.ulp(start), Math.ulp(end))) { "Step cannot advance every timestamp at this epoch" }
    // Double epoch rounding can otherwise move a snapped boundary inside the original Instant.
    if (instant(start) > from) start -= stepSeconds
    if (instant(end) < to) end += stepSeconds
    val count = round((end - start) / stepSeconds) + 1
    require(count.isFinite() && count >= 1 && count <= Int.MAX_VALUE) { "Timeline exceeds indexed range" }
    var previous: Instant? = null
    val items = List(count.toInt()) {
        val time = instant(start + it * stepSeconds)
        require(previous == null || time > previous) { "Timeline timestamps do not advance" }
        previous = time
        time
    }
    require(items.first() <= from && items.last() >= to) { "Timeline cannot represent outward boundaries" }
    val hours = List(items.size) { it * stepSeconds / 3600 }
    return Timeline(items, hours, instant(start), (end - start) / 3600)
}

internal data class PreparedParam(val amplitude: Double, val speedRadiansPerHour: Double, val phaseRadians: Double)
internal fun evalH(hour: Double, params: List<PreparedParam>) = params.sumOf { it.amplitude * cos(it.speedRadiansPerHour * hour + it.phaseRadians) }
internal fun evalHPrime(hour: Double, params: List<PreparedParam>) = params.sumOf { -it.amplitude * it.speedRadiansPerHour * sin(it.speedRadiansPerHour * hour + it.phaseRadians) }
internal fun evalHDoublePrime(hour: Double, params: List<PreparedParam>) = params.sumOf { -it.amplitude * it.speedRadiansPerHour.pow(2) * cos(it.speedRadiansPerHour * hour + it.phaseRadians) }

// Per-day midpoint corrections match swift/Sources/SlackwaterKit/Prediction.swift.
internal class ParamProvider(constituents: List<HarmonicConstituent>, offset: Double, val start: Instant, private val endHour: Double) {
    private val inputs = constituents.filter { it.amplitude != 0.0 && Catalog.speed(it.name) != null } +
        if (offset != 0.0) listOf(HarmonicConstituent("Z0", offset, 0.0)) else emptyList()
    private val base = astro(start)
    private var chunk = 0.0
    private var prepared = prepare(0.0)
    var generation = 0
        private set
    fun params(hour: Double): List<PreparedParam> {
        val requested = floor(max(0.0, hour) / 24)
        if (requested != chunk) {
            chunk = requested
            prepared = prepare(chunk * 24)
            generation++
        }
        return prepared
    }
    private fun prepare(beginHour: Double): List<PreparedParam> {
        val a = astro(shifted(start, (beginHour + min(beginHour + 24, endHour)) / 2 * 3600))
        return inputs.map { c ->
            val correction = Catalog.correction(c.name, a)
            PreparedParam(c.amplitude * correction.f, Catalog.speed(c.name)!! * D2R,
                (Catalog.v0(c.name, base) + correction.uDegrees - c.phaseDegrees) * D2R)
        }
    }
}
