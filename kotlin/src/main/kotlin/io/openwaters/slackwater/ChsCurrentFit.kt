package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.PI
import kotlin.math.cos

/**
 * How every Slackwater client fits a Canadian Hydrographic Service current
 * gate: IWLS [SPEED_SERIES] speed and [DIRECTION_SERIES] direction predictions
 * on a [SAMPLE_MINUTES] grid, combined into signed flood-axis velocity by
 * [project], and fitted with [basis]. TypeScript's `chsCurrentFit` and Swift's
 * `ChsCurrentFit` carry the same values, and all three are checked against
 * `fixtures/chs-current-fit.json`.
 *
 * A gate fits over one of [days], chosen per gate from validation: separating
 * K1 from P1 takes at least 183 days, so most gates need 210. A 210-day gate
 * can publish the fit of its trailing 60 days first, as a provisional answer,
 * when that fit matched every slack and its worst slack error, rounded up to
 * 5 minutes, was measured at or below [PROVISIONAL_SLACK_MAX_MINUTES].
 */
object ChsCurrentFit {
    const val SPEED_SERIES = "wcsp1"
    const val DIRECTION_SERIES = "wcdp1"
    val basis: List<String> = ChsTideFit.basis
    val days: List<Int> = listOf(60, 210)
    const val SAMPLE_MINUTES = 15
    const val PROVISIONAL_SLACK_MAX_MINUTES = 45

    /**
     * Signed velocity along the gate's flood axis: speed · cos(direction −
     * [floodDirection]), positive on the flood. The projection is linear, so
     * fitting it is equivalent to fitting both velocity components and
     * projecting the result. A speed sample without a direction at the same
     * instant is dropped, as is one whose speed or direction is not finite;
     * when a direction is repeated, its first value counts.
     * Samples come back in the order of [speeds].
     */
    fun project(speeds: List<HarmonicSample>, directions: List<HarmonicSample>, floodDirection: Double): List<HarmonicSample> {
        val directionAt = HashMap<Instant, Double>()
        for (d in directions) directionAt.putIfAbsent(d.time, d.value)
        return speeds.mapNotNull { s ->
            directionAt[s.time]?.takeIf { it.isFinite() && s.value.isFinite() }
                ?.let { HarmonicSample(s.time, s.value * cos((it - floodDirection) * PI / 180)) }
        }
    }
}
