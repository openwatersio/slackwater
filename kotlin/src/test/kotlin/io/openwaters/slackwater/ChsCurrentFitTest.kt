package io.openwaters.slackwater

import kotlin.test.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive

class ChsCurrentFitTest {
    private fun samples(rows: JsonArray) = rows.map { HarmonicSample(it.obj().instant("time"), it.obj().number("value")) }

    @Test fun matchesTheSharedRecipe() {
        val recipe = fixture("chs-current-fit")
        assertEquals(recipe.string("speedSeries"), ChsCurrentFit.SPEED_SERIES)
        assertEquals(recipe.string("directionSeries"), ChsCurrentFit.DIRECTION_SERIES)
        assertEquals(recipe.array("basis").map { it.jsonPrimitive.content }, ChsCurrentFit.basis)
        assertEquals(recipe.array("days").map { it.jsonPrimitive.content.toInt() }, ChsCurrentFit.days)
        assertEquals(recipe.number("sampleMinutes").toInt(), ChsCurrentFit.SAMPLE_MINUTES)
        assertEquals(recipe.number("provisionalSlackMaxMinutes").toInt(), ChsCurrentFit.PROVISIONAL_SLACK_MAX_MINUTES)
    }

    @Test fun dropsNonFiniteSamples() {
        val t = { i: Int -> java.time.Instant.parse("2026-01-01T00:00:00Z").plusSeconds(900L * i) }
        val speeds = listOf(Double.NaN, 2.0, 1.0).mapIndexed { i, v -> HarmonicSample(t(i), v) }
        val directions = listOf(135.0, Double.NaN, 135.0).mapIndexed { i, v -> HarmonicSample(t(i), v) }
        assertEquals(listOf(HarmonicSample(t(2), 1.0)), ChsCurrentFit.project(speeds, directions, 135.0))
    }

    @Test fun projectsOntoTheFloodAxis() {
        for (item in fixture("chs-current-fit").array("projections")) {
            val c = item.obj()
            val projected = ChsCurrentFit.project(samples(c.array("speeds")), samples(c.array("directions")), c.number("floodDirection"))
            val expected = samples(c.array("expected"))
            assertEquals(expected.map { it.time }, projected.map { it.time }, c.string("note"))
            projected.zip(expected).forEach { (p, e) -> assertEquals(e.value, p.value, 1e-12, c.string("note")) }
        }
    }

    @Test fun carriesTheGoldenStamp() {
        assertEquals(fixture("chs-current-golden").string("stamp"), ChsCurrentFit.STAMP)
    }

    @Test fun predictsTheGoldenWindowsFromTheReferenceFit() {
        val golden = fixture("chs-current-golden")
        val events = golden.getValue("events").obj()
        val from = events.instant("start")
        val to = events.instant("end")
        val inSpan = { t: java.time.Instant -> t >= from && t < to }
        val flood = golden.getValue("series").obj().number("floodDirection")
        for (item in golden.array("windows")) {
            val window = item.obj()
            val station = CurrentStation(window.constituents(), flood, (flood + 180) % 360, window.number("offset"))
            val label = "${window.number("days").toInt()} d"

            val velocities = station.speeds(from, to, 600.0).map { it.speedKnots }
            val expectedVelocities = window.array("velocities").map { it.jsonPrimitive.double }
            assertEquals(expectedVelocities.size, velocities.size, "$label velocities")
            velocities.zip(expectedVelocities).forEach { (a, e) -> assertEquals(e, a, 1e-4, "$label velocity") }

            val slacks = station.slacks(from, to).map { it.time }.filter(inSpan)
            val expected = window.array("slacks").map { java.time.Instant.parse(it.jsonPrimitive.content) }
            assertEquals(expected.size, slacks.size, label)
            slacks.zip(expected).forEach { (a, e) -> assertTrue(kotlin.math.abs(secondsBetween(a, e)) < 1.0, "$label slack near $e") }

            val extrema = station.maxima(from, to).filter { inSpan(it.time) }
            val expectedExtrema = window.array("extrema").map { it.obj() }
            assertEquals(expectedExtrema.map { currentKind(it.string("kind")) }, extrema.map { it.kind }, "$label extremum kinds")
            extrema.zip(expectedExtrema).forEach { (a, e) ->
                val time = e.instant("time")
                assertTrue(kotlin.math.abs(secondsBetween(a.time, time)) < 1.0, "$label extremum near $time")
                assertEquals(e.number("speed"), a.speedKnots, 1e-3, "$label extremum speed near $time")
            }
        }
    }
}
