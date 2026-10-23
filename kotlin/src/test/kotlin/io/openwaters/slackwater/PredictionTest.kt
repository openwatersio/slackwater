package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*
import kotlin.test.*

class PredictionTest {
    @Test fun timelineMatchesVictoria() {
        val f = fixture("prediction-victoria")
        val station = Station(f.constituents())
        val actual = station.heights(f.instant("start"), f.instant("end"), f.number("step"))
        val expected = f.array("points")
        assertEquals(expected.size, actual.size)
        for ((p, item) in actual.zip(expected)) {
            val e = item.obj()
            assertTrue(abs(secondsBetween(p.time, e.instant("time"))) < 0.5)
            assertTrue(abs(p.heightMetres - e.number("height")) < 1e-6)
        }
    }
    @Test fun ratesMatchIndependentDerivative() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val station = Station(listOf(HarmonicConstituent("S2", 2.0, 90.0)), 5.0)
        val heights = station.heights(t, t.plusSeconds(86400), 600.0)
        val rates = station.rates(t, t.plusSeconds(86400), 600.0)
        assertEquals(heights.map { it.time }, rates.map { it.time })
        for (p in rates) {
            val hours = secondsBetween(t, p.time) / 3600
            assertTrue(abs(p.rateMetresPerHour - (-2 * PI / 6 * sin(PI / 6 * hours - PI / 2))) < 1e-6)
        }
    }
    @Test fun floorCeilSupportsFractionalAndNegativeEpochs() {
        val from = Instant.parse("1969-12-31T23:59:59.250Z")
        val to = Instant.parse("1970-01-01T00:00:00.250Z")
        val p = Station(emptyList(), 3.0).heights(from, to, 0.5)
        assertEquals(listOf(-1.0, -0.5, 0.0, 0.5), p.map { it.time.epochSecond + it.time.nano / 1e9 })
        assertTrue(p.all { it.heightMetres == 3.0 })
        assertTrue(Station(listOf(HarmonicConstituent("unknown", 3.0, 0.0))).rates(from, to, 0.5).all { it.rateMetresPerHour == 0.0 })
        assertTrue(Station(listOf(HarmonicConstituent("M2", 0.0, 0.0))).heights(from, to).all { it.heightMetres == 0.0 })
    }
    @Test fun stationCopiesCallerInputs() {
        val f = fixture("prediction-victoria")
        val input = f.constituents().toMutableList()
        val station = Station(input)
        val first = station.heights(f.instant("start"), f.instant("end"))
        input.clear()
        station.heights(f.instant("start").plusSeconds(86400), f.instant("end").plusSeconds(86400))
        assertEquals(first, station.heights(f.instant("start"), f.instant("end")))
    }
}
