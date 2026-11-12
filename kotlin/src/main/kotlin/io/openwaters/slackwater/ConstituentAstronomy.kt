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

/**
 * Per-instant fitting basis from the bundled catalog, without caller definitions; null means the
 * constituent has no usable equilibrium definition.
 */
fun constituentAstronomy(name: String, time: Instant): ConstituentAstronomy? {
    if (!Catalog.shared.hasEquilibrium(name)) return null
    val a = astro(time)
    val c = Catalog.shared.correction(name, a)
    val v0 = Catalog.shared.v0(name, a)
    return ConstituentAstronomy(Catalog.shared.canonical(name), Catalog.shared.speed(name)!!, v0, c.uDegrees, wrap(v0 + c.uDegrees), c.f)
}
