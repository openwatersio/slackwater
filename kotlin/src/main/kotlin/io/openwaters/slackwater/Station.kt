package io.openwaters.slackwater

import java.time.Instant

/**
 * Offline harmonic tide station; the additive offset is in meters in the caller's datum.
 * [definitions] add constituents to the catalog, or replace catalog entries of the same name;
 * an invalid one throws [ConstituentDefinitionException].
 */
class Station internal constructor(constituents: List<HarmonicConstituent>, val offsetMetres: Double, internal val catalog: Catalog) {
    @JvmOverloads constructor(
        constituents: List<HarmonicConstituent>,
        offsetMetres: Double = 0.0,
        definitions: List<ConstituentDefinition> = emptyList(),
    ) : this(constituents, offsetMetres, Catalog.shared.with(definitions))

    internal val constituents = constituents.toList()
    internal val eventBracketHours = kotlin.math.PI / (2 * D2R *
        (this.constituents.filter { it.amplitude != 0.0 }.maxOfOrNull { catalog.speed(it.name) ?: 0.0 } ?: 0.0))
    internal val phaseSearchLimitSeconds = this.constituents.filter { it.amplitude != 0.0 }
        .mapNotNull { catalog.speed(it.name)?.takeIf { speed -> speed > 0.0 } }
        .minOrNull()?.let { 360.0 / it * 3600 } ?: 0.0
    init { require(offsetMetres.isFinite()) { "Offset must be finite" } }

    /** Includes the start floored and end ceiled to stepSeconds. */
    fun heights(from: Instant, to: Instant, stepSeconds: Double = 600.0): List<TidePoint> {
        val timeline = makeTimeline(from, to, stepSeconds)
        if (timeline.items.isEmpty()) return emptyList()
        val p = ParamProvider(catalog, constituents, offsetMetres, timeline.start, timeline.endHour)
        return timeline.items.zip(timeline.hours).map { (time, hour) -> TidePoint(time, evalH(hour, p.params(hour))) }
    }
    /** Analytic derivative in meters/hour, on the height timeline. */
    fun rates(from: Instant, to: Instant, stepSeconds: Double = 600.0): List<TideRatePoint> {
        val timeline = makeTimeline(from, to, stepSeconds)
        if (timeline.items.isEmpty()) return emptyList()
        val p = ParamProvider(catalog, constituents, offsetMetres, timeline.start, timeline.endHour)
        return timeline.items.zip(timeline.hours).map { (time, hour) -> TideRatePoint(time, evalHPrime(hour, p.params(hour))) }
    }
    fun extremes(from: Instant, to: Instant): List<TideExtreme> = extremes(from, to, 0.01)
    internal fun extremes(from: Instant, to: Instant, prominenceThreshold: Double): List<TideExtreme> {
        if (to < from) return emptyList()
        val start = instant(kotlin.math.floor(epochSeconds(from) / 600) * 600)
        val end = instant(kotlin.math.ceil(epochSeconds(to) / 600) * 600)
        return findExtremes(start, end, prominenceThreshold) { day -> ParamProvider(catalog, constituents, offsetMetres, day, 24.0) }.map {
            TideExtreme(it.time, it.level, if (it.high) ExtremeKind.HIGH else ExtremeKind.LOW)
        }
    }
}
