package io.openwaters.slackwater

import kotlin.math.*

// Port of packages/engine/src/node-corrections/schureman.ts. A missing formula lets the
// catalog resolve the constituent through its members.
internal fun schuremanCorrection(name: String, a: Astro, perigeeTurns: Double): NodeCorrection? {
    val omega = D2R * a["omega"]
    val i = D2R * a["i"]
    val inclination = D2R * a["I"]
    val nu = D2R * a["nu"]
    val xiDegrees = a["xi"]
    val nuDegrees = a["nu"]
    val sinI = sin(inclination)
    val cosHalfI = cos(inclination / 2)
    val cosHalfIOrbit = cos(i / 2).pow(4)
    val inclinationMean = 1 - 1.5 * sin(i).pow(2)
    val uM2 = 2 * (xiDegrees - nuDegrees)

    return when (name) {
        "Mm" -> { // Equations 73, 65
            val mean = (2.0 / 3 - sin(omega).pow(2)) * inclinationMean
            NodeCorrection((2.0 / 3 - sinI.pow(2)) / mean, 0.0)
        }
        "Mf" -> NodeCorrection(sinI.pow(2) / (sin(omega).pow(2) * cosHalfIOrbit), -2 * xiDegrees) // Equations 74, 66
        "O1" -> NodeCorrection(schuremanO1(omega, cosHalfIOrbit, sinI, cosHalfI), 2 * xiDegrees - nuDegrees) // Equations 75, 67
        "J1" -> NodeCorrection(sin(2 * inclination) / (sin(2 * omega) * inclinationMean), -nuDegrees) // Equations 76, 68
        "OO1" -> { // Equations 77, 69
            val mean = sin(omega) * sin(omega / 2).pow(2) * cosHalfIOrbit
            NodeCorrection(sinI * sin(inclination / 2).pow(2) / mean, -2 * xiDegrees - nuDegrees)
        }
        "M2" -> NodeCorrection(schuremanM2(omega, cosHalfIOrbit, cosHalfI), uM2) // Equations 78, 70
        "K1" -> { // Equations 227, 226, 68
            val sin2I = sin(2 * inclination)
            val mean = 0.5023 * sin(2 * omega) * inclinationMean + 0.1681
            val amplitude = sqrt(0.2523 * sin2I.pow(2) + 0.1689 * sin2I * cos(nu) + 0.0283)
            NodeCorrection(amplitude / mean, -a["nup"])
        }
        "K2" -> { // Equations 235, 234, 71
            val mean = 0.5023 * sin(omega).pow(2) * inclinationMean + 0.0365
            val amplitude = sqrt(0.2523 * sinI.pow(4) + 0.0367 * sinI.pow(2) * cos(2 * nu) + 0.0013)
            NodeCorrection(amplitude / mean, -2 * a["nupp"])
        }
        "L2" -> { // Equations 215, 213, 204, 214
            val perigee = D2R * a["P"]
            val t = tan(inclination / 2).pow(2)
            val amplitude = sqrt(1 - 12 * t * cos(2 * perigee) + 36 * t * t)
            val phase = R2D * atan(sin(2 * perigee) / (1 / (6 * t) - cos(2 * perigee)))
            NodeCorrection(schuremanM2(omega, cosHalfIOrbit, cosHalfI) * amplitude, uM2 - phase)
        }
        "M1" -> { // Equations 206, 207, 195, 202
            val perigee = D2R * a["P"]
            val cosI = cos(inclination)
            val ratio = cosI / cosHalfI.pow(2)
            val amplitude = sqrt(0.25 + 1.5 * ratio * cos(2 * perigee) + 2.25 * ratio * ratio)
            val k = (5 * cosI - 1) / (7 * cosI + 1)
            // atan2 keeps Q in P's half-turn. Equation 202 uses an argument without p.
            val q = R2D * atan2(k * sin(perigee), cos(perigee))
            NodeCorrection(schuremanO1(omega, cosHalfIOrbit, sinI, cosHalfI) * amplitude,
                wrapDegrees(xiDegrees - nuDegrees + q - perigeeTurns * a["p"]))
        }
        "M3" -> NodeCorrection(schuremanM2(omega, cosHalfIOrbit, cosHalfI).pow(1.5), 1.5 * uM2) // Equation 149
        else -> null
    }
}

private fun schuremanO1(omega: Double, cosHalfIOrbit: Double, sinI: Double, cosHalfI: Double): Double =
    sinI * cosHalfI.pow(2) / (sin(omega) * cos(omega / 2).pow(2) * cosHalfIOrbit)

private fun schuremanM2(omega: Double, cosHalfIOrbit: Double, cosHalfI: Double): Double =
    cosHalfI.pow(4) / (cos(omega / 2).pow(4) * cosHalfIOrbit)
