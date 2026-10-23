package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*

class SubordinateCurrentTest {
    @Test fun shortSlowCurrentCurvesUseSurroundingKnots() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val ref = CurrentStation(listOf(HarmonicConstituent("Mf", 2.0, 0.0), HarmonicConstituent("Mm", 1.0, 0.0)))
        val s = SubordinateCurrentStation(ref, 600.0, -600.0, 300.0, -300.0, 1.5, 0.5)
        val events = s.events(t, t.plusSeconds(40 * 86400))
        val (a, b) = events.zipWithNext().maxBy { secondsBetween(it.first.time, it.second.time) }
        assertTrue(secondsBetween(a.time, b.time) > 16 * 3600)
        val midpoint = a.time.plusSeconds((secondsBetween(a.time, b.time) / 2).toLong())
        val from = midpoint.minusSeconds(6 * 3600)
        val to = midpoint.plusSeconds(6 * 3600)
        val wide = s.speeds(t, t.plusSeconds(40 * 86400), 3600.0).associateBy { it.time }
        val narrow = s.speeds(from, to, 3600.0)
        assertTrue(narrow.size >= 2)
        assertTrue(abs(wide.getValue(narrow.first().time).speedKnots - wide.getValue(narrow.last().time).speedKnots) > 0.01)
        for (point in narrow) assertEquals(wide.getValue(point.time).speedKnots, point.speedKnots, 1e-9)
    }
    @Test fun shortSlackQueriesRetainSlowFollowingPhase() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val references = listOf(
            CurrentStation(listOf(HarmonicConstituent("K1", 2.0, 0.0)), offsetKnots = -1.9),
            CurrentStation(listOf(HarmonicConstituent("Mf", 2.0, 0.0), HarmonicConstituent("Mm", 1.0, 0.0)))
        )
        for (ref in references) {
            val s = SubordinateCurrentStation(ref, 600.0, -600.0, 0.0, 0.0, 1.0, 1.0)
            val all = s.events(t, t.plusSeconds(40 * 86400)).filter { it.kind == CurrentEventKind.SLACK }
            assertTrue(all.isNotEmpty())
            for (e in all) assertEquals(listOf(e), s.events(e.time.minusSeconds(10), e.time.plusSeconds(10)))
        }
    }
    private fun simple(flood: Double = 600.0, ebb: Double = -600.0) = SubordinateCurrentStation(
        CurrentStation(listOf(HarmonicConstituent("S2", 2.0, 0.0))), flood, ebb, 300.0, -300.0, 1.5, 0.5
    )
    @Test fun subordinateCurrentMatchesParity() {
        val f = fixture("currents-parity")
        val h = f.getValue("subordinate").obj()
        val s = h.subordinate(h.getValue("reference").obj().current())
        val events = s.events(f.instant("start"), f.instant("end"))
        assertEquals(h.array("events").size, events.size)
        for ((a, item) in events.zip(h.array("events"))) {
            val e = item.obj()
            assertEquals(currentKind(e.string("kind")), a.kind)
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 60)
            assertTrue(abs(a.speedKnots - e.number("speed")) < 0.02)
        }
        val speeds = s.speeds(f.instant("start"), f.instant("end"))
        assertEquals(h.array("timeline").size, speeds.size)
        for ((a, item) in speeds.zip(h.array("timeline"))) {
            val e = item.obj()
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 0.5)
            assertTrue(abs(a.speedKnots - e.number("speed")) < 1e-6, "${a.time}: ${a.speedKnots} vs ${e.number("speed")}")
        }
    }
    @Test fun slackUsesFollowingPhaseAndFallback() {
        val t = Instant.EPOCH
        val s = simple()
        val reduced = s.reduce(listOf(
            CurrentEvent(t, 0.001, CurrentEventKind.SLACK),
            CurrentEvent(t.plusSeconds(3600), -2.0, CurrentEventKind.MAX_EBB),
            CurrentEvent(t.plusSeconds(7200), 3.0, CurrentEventKind.MAX_FLOOD),
            CurrentEvent(t.plusSeconds(10800), 0.001, CurrentEventKind.SLACK)
        ))
        assertEquals(listOf(-600L, 3300L, 7500L, 11400L), reduced.map { it.time.epochSecond })
        assertEquals(listOf(0.0, -1.0, 4.5, 0.0), reduced.map { it.speedKnots })
        assertTrue(reduced.all { it.directionDegrees == null })
        val actual = Instant.parse("2026-01-01T02:50:00Z")
        val narrow = s.events(actual.minusSeconds(60), actual.plusSeconds(60))
        assertEquals(1, narrow.size)
        assertEquals(CurrentEventKind.SLACK, narrow.single().kind)
        assertTrue(abs(secondsBetween(actual, narrow.single().time)) < 1)
    }
    @Test fun largeOffsetsRetainReferenceEventsAndWindowsAgree() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val s = simple(24 * 3600.0, -24 * 3600.0)
        val all = s.events(t, t.plusSeconds(2 * 86400))
        assertTrue(all.isNotEmpty())
        val from = t.plusSeconds(8 * 3600)
        val to = t.plusSeconds(32 * 3600)
        assertEquals(all.filter { it.time >= from && it.time <= to }, s.events(from, to))
        assertTrue(all.zipWithNext().all { (a,b) -> a.time <= b.time })
        assertTrue(s.events(t.plusSeconds(1), t).isEmpty())
        assertTrue(s.speeds(t.plusSeconds(1), t).isEmpty())
        assertTrue(s.speeds(t, t).isNotEmpty())
    }
    @Test fun curveHitsEventsAndCoincidentEventsStayFinite() {
        val f = fixture("currents-parity")
        val h = f.getValue("subordinate").obj()
        val s = h.subordinate(h.getValue("reference").obj().current())
        val events = s.events(f.instant("start"), f.instant("end"))
        val speeds = s.speeds(f.instant("start"), f.instant("end"), 60.0)
        for (e in events) assertTrue(abs(speeds.minBy { abs(secondsBetween(it.time, e.time)) }.speedKnots - e.speedKnots) < 0.01)
        for ((a,b) in events.zipWithNext()) {
            val between = speeds.filter { it.time > a.time && it.time < b.time }
            assertTrue(between.zipWithNext().all { (x,y) -> if (b.speedKnots > a.speedKnots) y.speedKnots >= x.speedKnots else y.speedKnots <= x.speedKnots })
        }
        val t = Instant.EPOCH
        val coincident = simple().reduce(listOf(CurrentEvent(t.plusSeconds(600), 0.0, CurrentEventKind.SLACK), CurrentEvent(t.plusSeconds(300), -2.0, CurrentEventKind.MAX_EBB)))
        assertEquals(1, coincident.map { it.time }.distinct().size)
        val curve = halfCosineCurve(coincident.map { it.time to it.speedKnots }, listOf(t, t.plusSeconds(60)))
        assertTrue(curve.all { it.value == -1.0 && it.ratePerHour == 0.0 })
    }
    @Test fun invalidInputsFailAndDirectionsNormalize() {
        val ref = CurrentStation(emptyList())
        for (v in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, v, 0.0, 0.0, 0.0, 1.0, 1.0) }
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, v, 0.0, 0.0, 1.0, 1.0) }
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, v, 0.0, 1.0, 1.0) }
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, v, 1.0, 1.0) }
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, v, 1.0) }
            assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, 1.0, v) }
        }
        assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, -1.0, 1.0) }
        assertFailsWith<IllegalArgumentException> { SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0) }
        val s = SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, -90.0, 450.0)
        val events = s.reduce(listOf(CurrentEvent(Instant.EPOCH, 1.0, CurrentEventKind.MAX_FLOOD), CurrentEvent(Instant.EPOCH.plusSeconds(3600), -1.0, CurrentEventKind.MAX_EBB)))
        assertEquals(listOf(270.0, 90.0), events.map { it.directionDegrees })
    }
}
