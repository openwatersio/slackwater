package io.openwaters.slackwater

import java.io.File
import java.time.Instant
import kotlin.math.abs
import kotlin.test.*
import kotlinx.serialization.json.*

class ForemanTest {
    private val prediction = fixture("prediction-foreman")
    private fun foreman(latitude: Double) = NodeCorrections.Foreman(latitude)

    // UTide's own f and u, written by packages/engine/scripts/gen-foreman.py. The two astronomies
    // differ in their polynomials, which leaves about 1e-5 in f and 0.002° in u.
    @Test fun correctionsMatchUtide() {
        val reference = Json.parseToJsonElement(File(System.getProperty("fixtures"), "foreman-utide.json").readText()).jsonArray
        for (item in reference) {
            val entry = item.obj()
            val catalog = Catalog.shared.correctedWith(foreman(entry.number("latitude")), emptyList())
            val a = astro(entry.instant("time"))
            for ((name, value) in entry.getValue("values").obj()) {
                val (f, u) = value.jsonArray.map { it.jsonPrimitive.double }
                val actual = catalog.correction(name, a)
                assertTrue(abs(actual.f - f) < 1e-4, name)
                assertTrue(angularDiff(actual.uDegrees, u) < 0.01, name)
            }
        }
    }

    @Test fun predictsAsTheEngineDoes() {
        for (item in prediction.array("cases")) {
            val case = item.obj()
            val station = Station(prediction.constituents(), nodeCorrections = foreman(case.number("latitude")))
            val heights = station.heights(prediction.instant("start"), prediction.instant("end"), prediction.number("step"))
            assertEquals(case.array("points").size, heights.size)
            for ((p, point) in heights.zip(case.array("points"))) {
                val e = point.obj()
                assertEquals(e.instant("time"), p.time)
                assertTrue(abs(p.heightMetres - e.number("height")) < 1e-6)
            }
            val extremes = station.extremes(prediction.instant("start"), prediction.instant("end"))
            assertEquals(case.array("extremes").size, extremes.size)
            for ((x, extreme) in extremes.zip(case.array("extremes"))) {
                val e = extreme.obj()
                assertEquals(e.string("kind"), x.kind.name.lowercase())
                assertTrue(abs(secondsBetween(x.time, e.instant("time"))) < 1)
                assertTrue(abs(x.heightMetres - e.number("height")) < 1e-6)
            }
        }
    }

    @Test fun predictsCurrentsOnBothAxes() {
        val case = prediction.array("cases")[0].obj()
        val constituents = prediction.constituents()
        val station = CurrentStation(constituents, 0.0, 180.0, minorConstituents = constituents, azimuthDegrees = 0.0,
            nodeCorrections = foreman(case.number("latitude")))
        val speeds = station.speeds(prediction.instant("start"), prediction.instant("end"), prediction.number("step"))
        assertEquals(case.array("points").size, speeds.size)
        for ((p, point) in speeds.zip(case.array("points"))) {
            assertEquals(point.obj().instant("time"), p.time)
            assertTrue(abs(p.speedKnots - point.obj().number("height")) < 1e-6)
            assertTrue(abs(p.magnitudeKnots - abs(p.speedKnots) * kotlin.math.sqrt(2.0)) < 1e-9)
        }
    }

    @Test fun holdsTheLatitudeFiveDegreesFromTheEquator() {
        val a = astro(Instant.parse("2010-05-01T00:00:00Z"))
        val k1 = { latitude: Double -> Catalog.shared.correctedWith(foreman(latitude), emptyList()).correction("K1", a) }
        assertEquals(k1(4.0), k1(0.0))
        assertEquals(k1(-5.0), k1(-1.0))
        assertNotEquals(k1(1.0), k1(-1.0))
    }

    @Test fun leavesLinesForemanDoesNotGiveUncorrected() {
        val a = astro(Instant.parse("2010-05-01T00:00:00Z"))
        val catalog = Catalog.shared.correctedWith(foreman(60.0), emptyList())
        for (name in listOf("Sa", "Mf", "unknown")) assertEquals(NodeCorrection(1.0, 0.0), catalog.correction(name, a), name)
        // The catalog's M1 is the line t_tide calls NO1.
        assertEquals(catalog.correction("NO1", a), catalog.correction("M1", a))
    }

    @Test fun rejectsAnInvalidLatitude() {
        for (latitude in listOf(Double.NaN, 91.0, -90.5)) {
            assertFailsWith<NodeCorrectionsException.InvalidLatitude> { Station(emptyList(), nodeCorrections = foreman(latitude)) }
            val e = assertFailsWith<NodeCorrectionsException.InvalidLatitude> { CurrentStation(emptyList(), nodeCorrections = foreman(latitude)) }
            assertEquals("invalidLatitude", e.message)
        }
    }

    @Test fun refusesLinesTTideNamesDifferently() {
        for ((name, line) in prediction.getValue("refused").obj()) {
            val harmonics = listOf(HarmonicConstituent(name, 0.1, 0.0))
            val e = assertFailsWith<NodeCorrectionsException.NotForemanLine> { Station(harmonics, nodeCorrections = foreman(60.0)) }
            assertEquals(name, e.name)
            assertEquals(line.jsonPrimitive.content, e.line)
            assertEquals("notForemanLine: $name (t_tide's is ${e.line})", e.message)
            assertFailsWith<NodeCorrectionsException.NotForemanLine> {
                CurrentStation(emptyList(), minorConstituents = harmonics, nodeCorrections = foreman(60.0))
            }
            // IHO's corrections predict them as the catalog defines them.
            Station(harmonics)
        }
    }

    @Test fun predictsACallersOwnDefinitionUnderARefusedName() {
        val t = Instant.parse("2024-03-10T00:00:00Z")
        val kv = Catalog.shared.speed("SA_KV")!!
        val definitions = listOf(ConstituentDefinition("Sa", kv, listOf(0, 0, 1, 0, 0, -1, 0)))
        val own = Station(listOf(HarmonicConstituent("Sa", 0.1, 0.0)), 0.0, definitions, foreman(60.0))
        val sakv = Station(listOf(HarmonicConstituent("SA_KV", 0.1, 0.0)), nodeCorrections = foreman(60.0))
        assertEquals(sakv.heights(t, t)[0].heightMetres, own.heights(t, t)[0].heightMetres, 1e-12)
    }
}
