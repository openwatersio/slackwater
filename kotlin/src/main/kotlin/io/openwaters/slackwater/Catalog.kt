package io.openwaters.slackwater

import kotlin.math.abs
import kotlin.math.pow

internal data class Member(val name: String, val factor: Double)
internal data class CatalogEntry(val name: String, val speed: Double, val coefficients: List<Int>?, val members: List<Member>)
internal object Catalog {
    private val byName = catalogEntries.associateBy { it.name }
    fun canonical(name: String) = catalogAliases[name] ?: name
    fun speed(name: String): Double? = byName[canonical(name)]?.speed
    fun hasEquilibrium(name: String): Boolean {
        val entry = byName[canonical(name)] ?: return false
        return entry.coefficients != null || (entry.members.isNotEmpty() && entry.members.all { hasEquilibrium(it.name) })
    }
    fun v0(name: String, a: Astro): Double {
        val e = byName[canonical(name)] ?: return 0.0
        val c = e.coefficients
        if (c != null) {
            val args = listOf(a["T+h-s"], a["s"], a["h"], a["p"], -a["N"], a["pp"], 90.0)
            return c.indices.sumOf { c[it] * args[it] }
        }
        return e.members.sumOf { it.factor * v0(it.name, a) }
    }
    fun correction(name: String, a: Astro): NodeCorrection {
        val key = canonical(name)
        ihoCorrection(key, a)?.let { return it }
        var f = 1.0
        var u = 0.0
        for (m in byName[key]?.members.orEmpty()) {
            val c = correction(m.name, a)
            f *= c.f.pow(abs(m.factor))
            u += m.factor * c.uDegrees
        }
        return NodeCorrection(f, u)
    }
}
