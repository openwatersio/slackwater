package io.openwaters.slackwater

import kotlin.math.abs
import kotlin.math.pow

/**
 * A constituent as data: its speed, astronomical argument and nodal correction. Pass definitions
 * to predict or fit lines the catalog doesn't have, or defines differently. Same shape as
 * `ConstituentDefinition` in `@slackwater/engine`.
 *
 * [speed] is degrees per hour and must match the rate of the argument the coefficients or members
 * give. [coefficients] are Doodson numbers for τ, s, h, p, N′ and p′, then the multiple of 90°, in
 * Schureman's convention (IHO's XDO with D₂ to D₆ less 5 and D₇ as 5 − D₇), or null for a compound
 * whose argument is the sum of its members' arguments. [members] are the constituents whose nodal
 * corrections combine into this one's; empty for no correction, unless the name or an alias has
 * its own correction formula.
 */
data class ConstituentDefinition @JvmOverloads constructor(
    val name: String,
    val speed: Double,
    val coefficients: List<Int>?,
    val aliases: List<String> = emptyList(),
    val members: List<Member> = emptyList(),
) {
    data class Member(val name: String, val factor: Double)
}

/** Why a set of constituent definitions was rejected; [name] is the name at fault. */
sealed class ConstituentDefinitionException(code: String, val name: String) : IllegalArgumentException("$code: $name") {
    /**
     * A malformed field, a negative speed or one that doesn't match the argument, names that belong
     * to two constituents, or a replacement for Z0, which carries datum offsets.
     */
    class InvalidDefinition(name: String) : ConstituentDefinitionException("invalidDefinition", name)
    /** A name defined twice, or two definitions for one catalog entry. */
    class DuplicateConstituent(name: String) : ConstituentDefinitionException("duplicateConstituent", name)
    /** A member that names no constituent. */
    class UnknownConstituent(name: String) : ConstituentDefinitionException("unknownConstituent", name)
    /** Members that form a cycle. */
    class CyclicConstituent(name: String) : ConstituentDefinitionException("cyclicConstituent", name)
}

internal data class Member(val name: String, val factor: Double)
internal data class CatalogEntry(val name: String, val speed: Double, val coefficients: List<Int>?, val members: List<Member>)

/**
 * The generated catalog plus any caller definitions. Members link to entries by index, so a
 * definition that replaces an entry leaves the catalog's own compounds on the entry they were
 * built with. Port of defineConstituents in packages/engine/src/constituents/definition.ts.
 */
internal class Catalog private constructor(private val entries: List<Entry>, private val index: Map<String, Int>) {
    private class Link(val index: Int, val factor: Double)
    private class Entry(
        val name: String,
        val speed: Double,
        val coefficients: List<Int>?,
        var members: List<Link>,
        /** Names whose correction formula applies: the name, then aliases and replaced entries' names. */
        val formulaNames: List<String>,
    )

    companion object {
        val shared: Catalog = run {
            val index = HashMap<String, Int>()
            catalogEntries.forEachIndexed { i, entry -> index[entry.name] = i }
            val formulaNames = catalogEntries.associate { it.name to mutableListOf(it.name) }
            for ((alias, canonical) in catalogAliases) {
                index[alias] = index.getValue(canonical)
                formulaNames.getValue(canonical) += alias
            }
            val entries = catalogEntries.map { e ->
                Entry(e.name, e.speed, e.coefficients, e.members.map { Link(index.getValue(it.name), it.factor) }, formulaNames.getValue(e.name))
            }
            Catalog(entries, index)
        }

        private fun validate(d: ConstituentDefinition) {
            // Extremes and slack search assume every line turns forward.
            val valid = d.name.isNotEmpty() && d.speed.isFinite() && d.speed >= 0 && (d.coefficients?.size ?: 7) == 7 &&
                d.aliases.all { it.isNotEmpty() } && d.members.all { it.factor.isFinite() }
            if (!valid) throw ConstituentDefinitionException.InvalidDefinition(d.name)
        }
    }

    /** This catalog plus [definitions], checked the way the engine's `defineConstituents` checks them. */
    fun with(definitions: List<ConstituentDefinition>): Catalog {
        if (definitions.isEmpty()) return this
        val entries = entries.toMutableList()
        val index = HashMap(index)
        val first = entries.size
        val built = HashSet<Int>()
        // Stations add datum offsets and mean flows as a Z0 term, so Z0 must stay a constant.
        val offset = index["Z0"]
        for (definition in definitions) {
            validate(definition)
            val keys = (listOf(definition.name) + definition.aliases).distinct()
            val replaced = HashSet<Int>()
            for (key in keys) {
                val i = index[key] ?: continue
                if (i in built) throw ConstituentDefinitionException.DuplicateConstituent(key)
                replaced += i
            }
            if (replaced.size > 1) throw ConstituentDefinitionException.InvalidDefinition(definition.name)
            if (offset != null && offset in replaced) throw ConstituentDefinitionException.InvalidDefinition(definition.name)
            val added = entries.size
            val formulaNames = keys.toMutableList()
            for ((key, i) in index.entries.sortedBy { it.key }) {
                if (i !in replaced) continue
                index[key] = added
                if (key !in formulaNames) formulaNames += key
            }
            for (key in keys) index[key] = added
            entries += Entry(definition.name, definition.speed, definition.coefficients, emptyList(), formulaNames)
            built += added
        }
        // Second pass, so members can name definitions later in the list.
        definitions.forEachIndexed { offset, definition ->
            entries[first + offset].members = definition.members.map {
                Link(index[it.name] ?: throw ConstituentDefinitionException.UnknownConstituent(it.name), it.factor)
            }
        }
        // v0 and correction recurse through members, so a cycle would never return.
        val done = HashSet<Int>()
        fun visit(i: Int, path: MutableSet<Int>) {
            if (i in path) throw ConstituentDefinitionException.CyclicConstituent(entries[i].name)
            if (i in done) return
            path += i
            for (member in entries[i].members) visit(member.index, path)
            path -= i
            done += i
        }
        for (i in first until entries.size) visit(i, HashSet())
        val catalog = Catalog(entries, index)
        // Prediction advances V₀ at the speed, and extremes restart it each day, so they must agree.
        for (i in first until entries.size) {
            if (!(abs(catalog.rate(i) - entries[i].speed) <= 1e-5)) {
                throw ConstituentDefinitionException.InvalidDefinition(entries[i].name)
            }
        }
        return catalog
    }

    /** Degrees per hour at which [v0] advances. */
    private fun rate(i: Int): Double {
        val e = entries[i]
        e.coefficients?.let { c -> return c.indices.sumOf { c[it] * catalogArgumentRates[it] } }
        if (e.members.isEmpty()) return Double.NaN
        return e.members.sumOf { it.factor * rate(it.index) }
    }

    fun canonical(name: String) = index[name]?.let { entries[it].name } ?: name
    fun speed(name: String): Double? = index[name]?.let { entries[it].speed }
    fun hasEquilibrium(name: String): Boolean = index[name]?.let(::hasEquilibrium) ?: false
    private fun hasEquilibrium(i: Int): Boolean {
        val e = entries[i]
        return e.coefficients != null || (e.members.isNotEmpty() && e.members.all { hasEquilibrium(it.index) })
    }
    fun v0(name: String, a: Astro): Double = index[name]?.let { v0(it, a) } ?: 0.0
    private fun v0(i: Int, a: Astro): Double {
        val e = entries[i]
        val c = e.coefficients
        if (c != null) {
            val args = listOf(a["T+h-s"], a["s"], a["h"], a["p"], -a["N"], a["pp"], 90.0)
            return c.indices.sumOf { c[it] * args[it] }
        }
        return e.members.sumOf { it.factor * v0(it.index, a) }
    }
    fun correction(name: String, a: Astro): NodeCorrection {
        val i = index[name] ?: return ihoCorrection(name, a) ?: NodeCorrection(1.0, 0.0)
        return correction(i, a)
    }
    private fun correction(i: Int, a: Astro): NodeCorrection {
        val e = entries[i]
        for (name in e.formulaNames) ihoCorrection(name, a)?.let { return it }
        var f = 1.0
        var u = 0.0
        for (m in e.members) {
            val c = correction(m.index, a)
            f *= c.f.pow(abs(m.factor))
            u += m.factor * c.uDegrees
        }
        return NodeCorrection(f, u)
    }
}
