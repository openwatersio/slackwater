package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*

sealed interface HeightOffset {
    data class Ratio(val high: Double, val low: Double) : HeightOffset {
        init { require(high.isFinite() && low.isFinite() && high >= 0 && low >= 0) { "Height ratios must be finite and nonnegative" } }
    }
    data class Fixed(val high: Double, val low: Double) : HeightOffset {
        init { require(high.isFinite() && low.isFinite()) { "Height offsets must be finite" } }
    }
}

/** Ratio reductions require a reference in chart datum; fixed corrections add meters. */
class SubordinateTideStation(
    private val reference: Station,
    val highTimeOffsetSeconds: Double,
    val lowTimeOffsetSeconds: Double,
    val height: HeightOffset
) {
    init { require(highTimeOffsetSeconds.isFinite() && lowTimeOffsetSeconds.isFinite()) { "Time offsets must be finite" } }

    fun extremes(from: Instant, to: Instant): List<TideExtreme> = extremes(from, to, 0.01)
    private fun extremes(from: Instant, to: Instant, prominence: Double): List<TideExtreme> {
        if (to < from) return emptyList()
        val pad = max(abs(highTimeOffsetSeconds), abs(lowTimeOffsetSeconds)) + 3600
        return reference.extremes(shifted(from, -pad), shifted(to, pad), prominence).map { e ->
            val high = e.kind == ExtremeKind.HIGH
            val value = when (val h = height) {
                is HeightOffset.Ratio -> e.heightMetres * if (high) h.high else h.low
                is HeightOffset.Fixed -> e.heightMetres + if (high) h.high else h.low
            }
            TideExtreme(shifted(e.time, if (high) highTimeOffsetSeconds else lowTimeOffsetSeconds), value, e.kind)
        }.filter { it.time >= from && it.time <= to }.sortedBy { it.time }
    }
    fun heights(from: Instant, to: Instant, stepSeconds: Double = 600.0): List<TidePoint> =
        curve(from, to, stepSeconds).map { TidePoint(it.time, it.value) }
    fun rates(from: Instant, to: Instant, stepSeconds: Double = 600.0): List<TideRatePoint> =
        curve(from, to, stepSeconds).map { TideRatePoint(it.time, it.ratePerHour) }
    private fun curve(from: Instant, to: Instant, step: Double): List<CurvePoint> {
        val timeline = makeTimeline(from, to, step)
        if (timeline.items.isEmpty()) return emptyList()
        val first = timeline.items.first()
        val last = timeline.items.last()
        val knots = curveKnots(first, last, 15 * 3600.0, reference.phaseSearchLimitSeconds) { from, to ->
            // Knots have to surround the window. As in Swift, a tide whose turns are all below the
            // threshold, or kept farther apart than the pad, gets them from its raw turning points.
            var events = extremes(from, to)
            if (events.size < 2 || events.first().time > first || events.last().time < last) events = extremes(from, to, 0.0)
            events.map { it.time to it.heightMetres }
        }
        return halfCosineCurve(knots, timeline.items)
    }
}
