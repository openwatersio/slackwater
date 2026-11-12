package io.openwaters.slackwater

import java.time.Instant

/** Amplitude is meters for tides or knots for currents; phase is Greenwich degrees. */
data class HarmonicConstituent(val name: String, val amplitude: Double, val phaseDegrees: Double) {
    init { require(amplitude.isFinite() && phaseDegrees.isFinite()) { "Constituent constants must be finite" } }
}
/** One observation or prediction a harmonic fit is made from. */
data class HarmonicSample(val time: Instant, val value: Double)
data class TidePoint(val time: Instant, val heightMetres: Double)
data class TideRatePoint(val time: Instant, val rateMetresPerHour: Double)
enum class ExtremeKind { HIGH, LOW }
data class TideExtreme(val time: Instant, val heightMetres: Double, val kind: ExtremeKind)
data class CurrentPoint @JvmOverloads constructor(val time: Instant, val speedKnots: Double,
    val magnitudeKnots: Double = kotlin.math.abs(speedKnots), val directionDegrees: Double? = null) {
    // Java callers retain the two-field copy signature; vector fields are independent of signed speed.
    fun copy(time: Instant, speedKnots: Double): CurrentPoint = copy(time, speedKnots, magnitudeKnots, directionDegrees)
}
enum class CurrentEventKind { SLACK, MAX_FLOOD, MAX_EBB, MIN_FLOOD, MIN_EBB }
data class CurrentEvent(val time: Instant, val speedKnots: Double, val kind: CurrentEventKind, val directionDegrees: Double? = null)
