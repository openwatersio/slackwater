package io.openwaters.slackwater

import java.time.Instant
import kotlinx.serialization.json.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DefinitionsTest {
    private val fixture = fixture("constituent-definitions")

    private fun JsonObject.definitions() = array("definitions").map {
        val d = it.obj()
        ConstituentDefinition(
            d.string("name"),
            d.getValue("speed").jsonPrimitive.double,
            (d["coefficients"] as? JsonArray)?.map { c -> c.jsonPrimitive.int },
            d["aliases"]?.jsonArray?.map { a -> a.jsonPrimitive.content }.orEmpty(),
            d["members"]?.jsonArray?.map { m ->
                ConstituentDefinition.Member(m.jsonArray[0].jsonPrimitive.content, m.jsonArray[1].jsonPrimitive.double)
            }.orEmpty(),
        )
    }

    @Test fun predictsLikeTheEngine() {
        for (case in fixture.array("predictions").map { it.obj() }) {
            val name = case.string("name")
            val station = Station(case.constituents(), 0.0, case.definitions())
            val heights = station.heights(case.instant("start"), case.instant("end"), case.number("step"))
            val expected = case.array("heights").map { it.jsonPrimitive.double }
            assertEquals(expected.size, heights.size, name)
            expected.zip(heights).forEach { (want, got) -> assertEquals(want, got.heightMetres, 1e-6, name) }
            val extremes = station.extremes(case.instant("start"), case.instant("end"))
            val wanted = case.array("extremes").map { it.obj() }
            assertEquals(wanted.size, extremes.size, "$name extremes")
            for ((want, got) in wanted.zip(extremes)) {
                assertEquals(if (want.getValue("high").jsonPrimitive.boolean) ExtremeKind.HIGH else ExtremeKind.LOW, got.kind, name)
                assertTrue(kotlin.math.abs(secondsBetween(want.instant("time"), got.time)) < 60, "$name extreme time")
                assertEquals(want.number("level"), got.heightMetres, 0.02, "$name extreme level")
            }
        }
    }

    @Test fun predictsCurrentsFromDefinitions() {
        val case = fixture.array("predictions")[0].obj()
        val speeds = CurrentStation(case.constituents(), definitions = case.definitions())
            .speeds(case.instant("start"), case.instant("end"), case.number("step"))
        val expected = case.array("heights").map { it.jsonPrimitive.double }
        assertEquals(expected.size, speeds.size)
        expected.zip(speeds).forEach { (want, got) -> assertEquals(want, got.speedKnots, 1e-6) }
    }

    @Test fun fitsLikeTheEngine() {
        val case = fixture.getValue("fit").obj()
        val samples = case.array("samples").map {
            val s = it.obj()
            HarmonicSample(s.instant("time"), s.number("value"))
        }
        val result = fit(samples, case.array("basis").map { it.jsonPrimitive.content }, case.definitions())
        val expected = case.getValue("expected").obj().constituents()
        assertEquals(expected.size, result.constituents.size)
        for ((got, want) in result.constituents.zip(expected)) {
            assertEquals(want.name, got.name)
            assertEquals(want.amplitude, got.amplitude, 1e-6, want.name)
            assertTrue(angularDiff(want.phaseDegrees, got.phaseDegrees) < 1e-3, want.name)
        }
    }

    @Test fun predictsTheReadmeExample() {
        val station = Station(
            listOf(HarmonicConstituent("SA_X", 0.12, 210.0)),
            definitions = listOf(ConstituentDefinition("SA_X", 0.0410686, listOf(0, 0, 1, 0, 0, 0, -1))),
        )
        val from = Instant.parse("2026-01-01T00:00:00Z")
        assertTrue(station.heights(from, from.plusSeconds(3600)).all { it.heightMetres != 0.0 })
        assertTrue(Station(listOf(HarmonicConstituent("SA_X", 0.12, 210.0))).heights(from, from.plusSeconds(3600)).all { it.heightMetres == 0.0 })
    }

    @Test fun rejectsWhatTheEngineRejects() {
        for (case in fixture.array("errors").map { it.obj() }) {
            val name = case.string("name")
            val definitions = runCatching { case.definitions() }.getOrNull()
            if (definitions == null) {
                // A null speed or a fractional coefficient doesn't fit the types at all.
                assertEquals("invalidDefinition", case.string("error"), name)
                continue
            }
            val error = assertFailsWith<ConstituentDefinitionException>(name) { Station(emptyList(), 0.0, definitions) }
            assertEquals(case.string("error"), error.message!!.substringBefore(":"), name)
        }
    }
}
