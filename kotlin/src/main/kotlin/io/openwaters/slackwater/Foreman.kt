package io.openwaters.slackwater

import kotlin.math.*

/** The nodal correction formulas a station predicts with. */
sealed class NodeCorrections {
    /** IHO's, the default. */
    object Iho : NodeCorrections()

    /** Schureman’s spherical-geometry corrections. */
    object Schureman : NodeCorrections()

    /**
     * Foreman's satellite corrections, as t_tide and UTide apply them, for constants fitted that
     * way. [latitude] is the site's, in degrees north. The catalog's Sa, S1 and OQ2 are other
     * lines than t_tide's by those names, so a station that lists them is refused.
     */
    data class Foreman(val latitude: Double) : NodeCorrections()
}

/** Why a station's nodal corrections were rejected. */
sealed class NodeCorrectionsException(message: String) : IllegalArgumentException(message) {
    /** A latitude that isn't a number from -90 to 90. */
    class InvalidLatitude : NodeCorrectionsException("invalidLatitude")
    /** A catalog line [name] that t_tide knows by another name, and [line], the catalog's name for t_tide's. */
    class NotForemanLine(val name: String, val line: String) : NodeCorrectionsException("notForemanLine: $name (t_tide's is $line)")
}

/** Changes in p, N and p′, phase in cycles, amplitude ratio, and latitude factor kind. */
internal class ForemanSatellite(val p: Double, val n: Double, val pp: Double, val phase: Double, val ratio: Double, val kind: Double)

/**
 * Foreman's nodal corrections at a latitude: each main line's satellites summed, two of them
 * scaled by the latitude, and shallow-water lines as products of main lines. Port of
 * packages/engine/src/node-corrections/foreman.ts.
 */
internal class ForemanCorrections(latitude: Double) {
    private val factors: DoubleArray

    init {
        if (!(abs(latitude) <= 90)) throw NodeCorrectionsException.InvalidLatitude()
        // t_tide holds the latitude 5° from the equator, where the first factor grows without bound.
        val s = sin(D2R * if (abs(latitude) < 5) (if (latitude < 0) -5.0 else 5.0) else latitude)
        factors = doubleArrayOf(1.0, 0.36309 * (1 - 5 * s * s) / s, 2.59808 * s)
    }

    /** f and u for a line Foreman gives, or null. [perigeeTurns] is as in [ihoCorrection]. */
    fun correction(name: String, a: Astro, perigeeTurns: Double): NodeCorrection? {
        val line = aliases[name] ?: name
        foremanSatellites[line]?.let { satellites ->
            val c = main(satellites, a)
            // Foreman's NO1 argument holds one turn of p, as the catalog's M1 does.
            if (line != "NO1") return c
            return NodeCorrection(c.f, wrapDegrees(c.uDegrees - (perigeeTurns - 1) * a["p"]))
        }
        val members = foremanProducts[name] ?: return null
        var f = 1.0
        var u = 0.0
        for (m in members) {
            // Only NO1 reads the perigee count, and no product has it, so members get none.
            val c = correction(m.name, a, 0.0)!!
            f *= c.f.pow(abs(m.factor))
            u += m.factor * c.uDegrees
        }
        return NodeCorrection(f, u)
    }

    private companion object {
        /** Lines the catalog names one way and t_tide another: the catalog's M1 is t_tide's NO1. */
        val aliases = mapOf("M1" to "NO1", "H1" to "alpha2", "H2" to "M(KS)2")
    }

    private fun main(satellites: List<ForemanSatellite>, a: Astro): NodeCorrection {
        var re = 1.0
        var im = 0.0
        for (s in satellites) {
            val angle = D2R * (s.p * a["p"] + s.n * a["N"] + s.pp * a["pp"] + 360 * s.phase)
            val r = s.ratio * factors[s.kind.toInt()]
            re += r * cos(angle)
            im += r * sin(angle)
        }
        return NodeCorrection(hypot(re, im), R2D * atan2(im, re))
    }
}
