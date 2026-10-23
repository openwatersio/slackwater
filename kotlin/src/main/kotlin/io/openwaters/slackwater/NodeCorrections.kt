package io.openwaters.slackwater

import kotlin.math.*

internal data class NodeCorrection(val f: Double, val uDegrees: Double)
private fun fromSinCos(s: Double, c: Double) = NodeCorrection(sqrt(s * s + c * c), atan2(s, c) * R2D)

// IHO fundamentals: packages/engine/src/node-corrections/iho.ts.
internal fun ihoCorrection(name: String, a: Astro): NodeCorrection? {
    val n = a["N"] * D2R
    val p = a["p"] * D2R
    val pp = a["pp"] * D2R
    return when (name) {
        "Mm" -> NodeCorrection(1 - 0.1311 * cos(n) + 0.0538 * cos(2 * p) + 0.0205 * cos(2 * p - n), 0.0)
        "Mf" -> NodeCorrection(1.084 + 0.415 * cos(n) + 0.039 * cos(2 * n), -23.7 * sin(n) + 2.7 * sin(2 * n) - 0.4 * sin(3 * n))
        "O1" -> NodeCorrection(1.0176 + 0.1871 * cos(n) - 0.0147 * cos(2 * n), 10.8 * sin(n) - 1.34 * sin(2 * n) + 0.19 * sin(3 * n))
        "K1" -> NodeCorrection(1.006 + 0.115 * cos(n) - 0.0088 * cos(2 * n) + 6e-4 * cos(3 * n), -8.86 * sin(n) + 0.68 * sin(2 * n) - 0.07 * sin(3 * n))
        "J1" -> NodeCorrection(1.1029 + 0.1676 * cos(n) - 0.017 * cos(2 * n) + 0.0016 * cos(3 * n), -12.94 * sin(n) + 1.34 * sin(2 * n) - 0.19 * sin(3 * n))
        "M1B" -> fromSinCos(2.783 * sin(2 * p) + 0.558 * sin(2 * p - n) + 0.184 * sin(n), 1 + 2.783 * cos(2 * p) + 0.558 * cos(2 * p - n) + 0.184 * cos(n))
        "M1C", "M1" -> fromSinCos(sin(p) + 0.2 * sin(p - n), 2 * (cos(p) + 0.2 * cos(p - n)))
        "M1A" -> fromSinCos(-0.3593 * sin(2 * p) - 0.2 * sin(n) - 0.066 * sin(2 * p - n), 1 + 0.3593 * cos(2 * p) + 0.2 * cos(n) + 0.066 * cos(2 * p - n))
        "M2" -> NodeCorrection(1.0007 - 0.0373 * cos(n) + 2e-4 * cos(2 * n), -2.14 * sin(n))
        "K2" -> NodeCorrection(1.0246 + 0.2863 * cos(n) + 0.0083 * cos(2 * n) - 0.0015 * cos(3 * n), -17.74 * sin(n) + 0.68 * sin(2 * n) - 0.04 * sin(3 * n))
        "M3" -> NodeCorrection((1.0007 - 0.0373 * cos(n) + 2e-4 * cos(2 * n)).pow(1.5), -3.21 * sin(n))
        "L2" -> fromSinCos(-0.2505 * sin(2 * p) - 0.1102 * sin(2 * p - n) - 0.0156 * sin(2 * p - 2 * n) - 0.037 * sin(n), 1 - 0.2505 * cos(2 * p) - 0.1102 * cos(2 * p - n) - 0.0156 * cos(2 * p - 2 * n) - 0.037 * cos(n))
        "gamma2" -> fromSinCos(0.147 * sin(2 * (n - p)), 1 + 0.147 * cos(2 * (n - p)))
        "alpha2" -> fromSinCos(-0.0446 * sin(p - pp), 1 - 0.0446 * cos(p - pp))
        "delta2" -> fromSinCos(0.477 * sin(n), 1 - 0.477 * cos(n))
        "xi2", "eta2" -> fromSinCos(-0.439 * sin(n), 1 + 0.439 * cos(n))
        else -> null
    }
}
