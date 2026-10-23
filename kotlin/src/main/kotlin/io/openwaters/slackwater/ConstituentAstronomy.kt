package io.openwaters.slackwater

import java.time.Instant

/** Greenwich equilibrium arguments in degrees, speed in degrees/hour, and dimensionless nodal factor. */
data class ConstituentAstronomy(
    val canonicalName: String,
    val speedDegreesPerHour: Double,
    val v0Degrees: Double,
    val uDegrees: Double,
    val v0PlusUDegrees: Double,
    val nodalFactor: Double
)

/** Per-instant fitting basis; null means the constituent has no usable equilibrium definition. */
fun constituentAstronomy(name: String, time: Instant): ConstituentAstronomy? {
    if (!Catalog.hasEquilibrium(name)) return null
    val a = astro(time)
    val c = Catalog.correction(name, a)
    val v0 = Catalog.v0(name, a)
    return ConstituentAstronomy(Catalog.canonical(name), Catalog.speed(name)!!, v0, c.uDegrees, wrap(v0 + c.uDegrees), c.f)
}
