package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*

internal const val D2R = PI / 180
internal const val R2D = 180 / PI
internal fun wrap(value: Double) = ((value % 360) + 360) % 360
internal class Astro(val all: Map<String, Double>) {
    operator fun get(name: String) = all.getValue(name)
}

// Coefficients and node geometry: ../swift/Sources/SlackwaterKit/Astronomy.swift.
internal fun astro(time: Instant): Astro {
    val jd = 2440587.5 + (time.epochSecond.toDouble() + time.nano / 1e9) / 86400
    val t = (jd - 2451545) / 36525
    val coefficients = mapOf(
        "s" to listOf(218.3164591, 481267.88134236, -0.0013268, 1.0 / 538841 - 1.0 / 65194e3),
        "h" to listOf(280.46645, 36000.76983, 3032e-7),
        "p" to listOf(83.353243, 4069.0137111, -0.0103238, -1.0 / 80053, 1.0 / 18999e3),
        "N" to listOf(125.044555, -1934.1361849, 0.0020762, 1.0 / 467410, -1.0 / 60616e3),
        "pp" to listOf(-77.06265000000002, 1.7190199999968172, 4591e-7, 48e-8),
        "90" to listOf(90.0), "i" to listOf(5.145),
        "omega" to listOf(
            23 + 26.0 / 60 + 21.448 / 3600, -4680.93 / 3600, -1.55 / 3600,
            1999.25 / 3600, -51.38 / 3600, -249.67 / 3600, -39.05 / 3600,
            7.12 / 3600, 27.87 / 3600, 5.79 / 3600, 2.45 / 3600
        ).mapIndexed { index, c -> c * 0.01.pow(index) }
    )
    val a = coefficients.mapValues { (_, c) -> wrap(c.mapIndexed { index, v -> v * t.pow(index) }.sum()) }.toMutableMap()
    val n = a.getValue("N") * D2R
    val i = a.getValue("i") * D2R
    val omega = a.getValue("omega") * D2R
    val inclination = acos(cos(i) * cos(omega) - sin(i) * sin(omega) * cos(n))
    val e1 = atan(cos((omega - i) / 2) / cos((omega + i) / 2) * tan(n / 2)) - n / 2
    val e2 = atan(sin((omega - i) / 2) / sin((omega + i) / 2) * tan(n / 2)) - n / 2
    val nu = e1 - e2
    a["I"] = wrap(inclination * R2D)
    a["xi"] = wrap(-(e1 + e2) * R2D)
    a["nu"] = wrap(nu * R2D)
    a["nup"] = wrap(atan(sin(2 * inclination) * sin(nu) / (sin(2 * inclination) * cos(nu) + 0.3347)) * R2D)
    a["nupp"] = wrap(atan(sin(inclination).pow(2) * sin(2 * nu) / (sin(inclination).pow(2) * cos(2 * nu) + 0.0727)) * 0.5 * R2D)
    a["T+h-s"] = (jd - floor(jd)) * 360 + a.getValue("h") - a.getValue("s")
    a["P"] = a.getValue("p") - a.getValue("xi") % 360
    return Astro(a)
}
