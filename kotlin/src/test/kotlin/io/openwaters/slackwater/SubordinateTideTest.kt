package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*

class SubordinateTideTest {
    @Test fun shortSlowTideCurvesBracketHeightsAndRates() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val ref = Station(listOf(HarmonicConstituent("Mm", 1.0, 0.0)))
        val s = SubordinateTideStation(ref, 600.0, -600.0, HeightOffset.Ratio(1.5, 0.5))
        val events = s.extremes(t, t.plusSeconds(90 * 86400))
        val (a, b) = events.zipWithNext().maxBy { secondsBetween(it.first.time, it.second.time) }
        assertTrue(secondsBetween(a.time, b.time) > 30 * 3600)
        val midpoint = a.time.plusSeconds((secondsBetween(a.time, b.time) / 2).toLong())
        val from = midpoint.minusSeconds(6 * 3600)
        val to = midpoint.plusSeconds(6 * 3600)
        val heights = s.heights(from, to, 3600.0)
        val rates = s.rates(from, to, 3600.0)
        assertTrue(heights.size >= 2)
        val duration = secondsBetween(a.time, b.time)
        for ((point, rate) in heights.zip(rates)) {
            val phase = Math.PI * secondsBetween(a.time, point.time) / duration
            val half = (a.heightMetres - b.heightMetres) / 2
            val expected = (a.heightMetres + b.heightMetres) / 2 + half * kotlin.math.cos(phase)
            val expectedRate = -half * Math.PI / duration * kotlin.math.sin(phase) * 3600
            assertEquals(expected, point.heightMetres, 0.01)
            assertEquals(expectedRate, rate.rateMetresPerHour, 1e-4)
        }
        assertTrue(abs(heights.last().heightMetres - heights.first().heightMetres) > 0.01)
    }
    @Test fun defaultRateStepIsTenMinutes() {
        val t = java.time.Instant.parse("2026-01-01T00:00:00Z")
        val s = SubordinateTideStation(Station(listOf(HarmonicConstituent("S2", 1.0, 0.0))), 0.0, 0.0, HeightOffset.Ratio(1.0, 1.0))
        val rates = s.rates(t, t.plusSeconds(600))
        assertEquals(2, rates.size)
        assertTrue(rates.all { it.rateMetresPerHour.isFinite() })
        assertEquals(600.0, secondsBetween(rates[0].time, rates[1].time))
    }

    @Test fun ratioAndFixedSubordinatesMatchNoaa() {
        val f = fixture("realworld-subordinates")
        assertEquals(2, f.array("cases").size)
        for (item in f.array("cases")) {
            val c = item.obj()
            val offsets = c.getValue("offsets").obj()
            val h = offsets.getValue("height").obj()
            val time = offsets.getValue("time").obj()
            val height = if (h.string("type") == "ratio") HeightOffset.Ratio(h.number("high"), h.number("low")) else HeightOffset.Fixed(h.number("high"), h.number("low"))
            val s = SubordinateTideStation(Station(c.constituents(), c.number("offset")), time.number("high") * 60, time.number("low") * 60, height)
            val events = s.extremes(f.instant("start").minusSeconds(3600), f.instant("end").plusSeconds(3600))
            assertTrue(c.array("official").isNotEmpty())
            for (row in c.array("official")) {
                val e = row.obj()
                val nearest = assertNotNull(events.filter { it.kind.name.lowercase() == e.string("kind") }.minByOrNull { abs(secondsBetween(it.time, e.instant("time"))) })
                assertTrue(abs(secondsBetween(nearest.time, e.instant("time"))) < 15 * 60, c.string("name"))
                assertTrue(abs(nearest.heightMetres - e.number("height")) < 0.15, c.string("name"))
            }
        }
    }
    @Test fun subordinateCurveHitsKnotsAndHasCorrectRateSign() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val s = SubordinateTideStation(Station(listOf(HarmonicConstituent("S2", 1.0, 90.0))), 600.0, -600.0, HeightOffset.Fixed(0.5, -0.5))
        val events = s.extremes(t, t.plusSeconds(86400))
        val heights = s.heights(t, t.plusSeconds(86400), 60.0)
        val rates = s.rates(t, t.plusSeconds(86400), 60.0)
        assertEquals(heights.map { it.time }, rates.map { it.time })
        for (e in events) assertTrue(abs(heights.minBy { abs(secondsBetween(e.time, it.time)) }.heightMetres - e.heightMetres) < 0.01)
        for ((a, b) in events.zipWithNext()) {
            val between = heights.zip(rates).filter { it.first.time > a.time && it.first.time < b.time }
            val rising = b.heightMetres > a.heightMetres
            assertTrue(between.all { if (rising) it.second.rateMetresPerHour >= 0 else it.second.rateMetresPerHour <= 0 })
            assertTrue(between.zipWithNext().all { (x, y) -> if (rising) y.first.heightMetres >= x.first.heightMetres else y.first.heightMetres <= x.first.heightMetres })
        }
    }
    @Test fun rawTurnsSupportSmallTides() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val s = SubordinateTideStation(Station(listOf(HarmonicConstituent("S2", 0.001, 90.0))), 0.0, 0.0, HeightOffset.Ratio(1.0, 1.0))
        assertTrue(s.heights(t, t.plusSeconds(86400)).any { abs(it.heightMetres) > 0.0009 })
        assertTrue(s.extremes(t.plusSeconds(1), t).isEmpty())
        assertTrue(s.heights(t.plusSeconds(1), t).isEmpty())
    }
    @Test fun shiftedExtremesAreSortedAndCropped() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val s = SubordinateTideStation(Station(listOf(HarmonicConstituent("S2", 1.0, 90.0))), 8 * 3600.0, -8 * 3600.0, HeightOffset.Ratio(2.0, 0.5))
        val events = s.extremes(t, t.plusSeconds(86400))
        assertTrue(events.isNotEmpty())
        assertTrue(events.all { it.time >= t && it.time <= t.plusSeconds(86400) })
        assertTrue(events.zipWithNext().all { (a,b) -> a.time <= b.time })
        assertTrue(events.all { abs(it.heightMetres - if (it.kind == ExtremeKind.HIGH) 2.0 else -0.5) < 1e-6 })
    }
    @Test fun invalidSubordinateInputsFail() {
        val ref = Station(emptyList())
        for (v in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { HeightOffset.Ratio(v, 1.0) }
            assertFailsWith<IllegalArgumentException> { HeightOffset.Fixed(1.0, v) }
            assertFailsWith<IllegalArgumentException> { SubordinateTideStation(ref, v, 0.0, HeightOffset.Fixed(0.0, 0.0)) }
        }
        assertFailsWith<IllegalArgumentException> { HeightOffset.Ratio(1.0, -1.0) }
    }
}
