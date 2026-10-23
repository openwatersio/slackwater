package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*

internal data class CurvePoint(val time: Instant, val value: Double, val ratePerHour: Double)
// Long-period constituents need neighboring knots beyond a fixed day-sized margin.
internal fun curveKnots(first: Instant, last: Instant, initialPadSeconds: Double, periodSeconds: Double,
    query: (Instant, Instant) -> List<Pair<Instant, Double>>): List<Pair<Instant, Double>> {
    var pad = initialPadSeconds
    val limit = initialPadSeconds + periodSeconds
    while (true) {
        val knots = query(shifted(first, -pad), shifted(last, pad))
        if (periodSeconds == 0.0 || (knots.isNotEmpty() && knots.first().first <= first && knots.last().first >= last)) return knots
        require(pad < limit) { "Cannot bracket subordinate curve within the constituent period" }
        pad = min(pad * 2, limit)
    }
}

// Half-cosine table drawing: swift/Sources/SlackwaterKit/Subordinate.swift.
internal fun halfCosineCurve(knots: List<Pair<Instant, Double>>, items: List<Instant>): List<CurvePoint> {
    val unique = knots.sortedBy { it.first }.toMap().toList()
    if (unique.size < 2) return items.map { CurvePoint(it, unique.firstOrNull()?.second ?: 0.0, 0.0) }
    var index = 0
    return items.map { time ->
        while (index + 2 < unique.size && unique[index + 1].first <= time) index++
        val (t1, v1) = unique[index]
        val (t2, v2) = unique[index + 1]
        val duration = epochSeconds(t2) - epochSeconds(t1)
        val u = ((epochSeconds(time) - epochSeconds(t1)) / duration).coerceIn(0.0, 1.0)
        val half = (v1 - v2) / 2
        val clamped = time < t1 || time > t2
        CurvePoint(time, (v1 + v2) / 2 + half * cos(PI * u),
            if (clamped) 0.0 else -half * PI / duration * sin(PI * u) * 3600)
    }
}
