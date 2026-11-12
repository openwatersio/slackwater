package io.openwaters.slackwater

import java.time.Instant
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.test.*

class CurrentTest {
    @Test fun currentTimelineAndEventsMatchParity() {
        val f = fixture("currents-parity")
        val h = f.getValue("harmonic").obj()
        val station = h.current()
        val points = station.speeds(f.instant("start"), f.instant("end"))
        assertEquals(h.array("timeline").size, points.size)
        for ((a, item) in points.zip(h.array("timeline"))) {
            val e = item.obj()
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 0.5)
            assertTrue(abs(a.speedKnots - e.number("speed")) < 1e-6)
        }
        // The TS oracle includes the entire last UTC day; exercise every row with explicit bounds.
        val (eventFrom, eventTo) = oracleSpan(h)
        val events = station.events(eventFrom, eventTo)
        assertEquals(h.array("events").size, events.size, "Actual events: $events")
        for ((a, item) in events.zip(h.array("events"))) {
            val e = item.obj()
            assertEquals(currentKind(e.string("kind")), a.kind)
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 60)
            assertTrue(abs(a.speedKnots - e.number("speed")) < 0.02)
        }
    }
    @Test fun analyticSlackRootsAndNonReversingMaxima() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val constants = listOf(HarmonicConstituent("S2", 2.0, 0.0))
        val s = CurrentStation(constants)
        val slacks = s.slacks(t, t.plusSeconds(86400))
        assertEquals(4, slacks.size)
        for ((index, e) in slacks.withIndex()) {
            assertTrue(abs(e.speedKnots) < 1e-3)
            assertTrue(abs(secondsBetween(t.plusSeconds((3L + index * 6) * 3600), e.time)) < 1)
        }
        for (offset in listOf(3.0, -3.0, 2.00001, -2.00001)) {
            val biased = CurrentStation(constants, offsetKnots = offset)
            assertTrue(biased.slacks(t, t.plusSeconds(86400)).isEmpty())
            val maxima = biased.maxima(t, t.plusSeconds(86400))
            assertTrue(maxima.isNotEmpty())
            assertTrue(maxima.all { it.kind == if (offset > 0) CurrentEventKind.MAX_FLOOD else CurrentEventKind.MAX_EBB })
            val events = biased.events(t, t.plusSeconds(86400))
            val minimum = if (offset > 0) "MIN_FLOOD" else "MIN_EBB"
            assertTrue(events.any { it.kind.name == minimum }, "Missing $minimum: $events")
            assertEquals(events.count { it.kind.name.startsWith("MAX_") }, maxima.size)
            assertTrue(events.all { it.directionDegrees == null })
        }
        assertTrue(CurrentStation(emptyList()).events(t, t.plusSeconds(86400)).isEmpty())
        assertTrue(CurrentStation(emptyList(), offsetKnots = 1.0).events(t, t.plusSeconds(86400)).isEmpty())
        assertTrue(s.events(t.plusSeconds(1), t).isEmpty())
        assertTrue(s.speeds(t.plusSeconds(1), t).isEmpty())
    }
    @Test fun minimaRetainPhaseOffsetsAndDoNotReadOrRankAsMaxima() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        for (offset in listOf(3.0, -3.0)) {
            val reference = CurrentStation(listOf(HarmonicConstituent("S2", 2.0, 90.0)), 90.0, 270.0, offset)
            val subordinate = SubordinateCurrentStation(reference, 100.0, 200.0, 300.0, 400.0, 2.0, 3.0, 45.0, 225.0)
            val events = reference.events(t, t.plusSeconds(86400))
            val minima = events.filter { it.kind == CurrentEventKind.MIN_FLOOD || it.kind == CurrentEventKind.MIN_EBB }
            assertTrue(minima.isNotEmpty())
            for (event in minima) {
                val flood = event.kind == CurrentEventKind.MIN_FLOOD
                assertEquals(if (flood) 90.0 else 270.0, event.directionDegrees)
                val reduced = subordinate.reduce(listOf(event)).single()
                assertEquals(event.kind, reduced.kind)
                assertEquals(event.time.plusSeconds(if (flood) 300 else 400), reduced.time)
                assertEquals(event.speedKnots * if (flood) 2.0 else 3.0, reduced.speedKnots)
                assertEquals(if (flood) 45.0 else 225.0, reduced.directionDegrees)
                assertEquals(if (flood) CurrentState.MIN_FLOOD else CurrentState.MIN_EBB,
                    readCurrent(event.time, reference.speeds(event.time.minusSeconds(60), event.time.plusSeconds(60), 60.0), events, 90.0, 270.0)?.state)
                assertTrue(events.maxSpeeds(event.kind).isEmpty())
                val knots = subordinate.events(reduced.time.minusSeconds(86400), reduced.time.plusSeconds(86400))
                assertTrue(knots.contains(reduced))
                val point = halfCosineCurve(knots.map { it.time to it.speedKnots }, listOf(reduced.time)).single()
                assertEquals(reduced.speedKnots, point.value, 1e-8)
            }
        }
        val reference = CurrentStation(listOf(HarmonicConstituent("S2", 2.0, 90.0)))
        val subordinate = SubordinateCurrentStation(reference, 100.0, 200.0, 300.0, 400.0, 2.0, 3.0)
        val reduced = subordinate.reduce(listOf(
            CurrentEvent(t, 0.0, CurrentEventKind.SLACK),
            CurrentEvent(t.plusSeconds(3600), 0.2, CurrentEventKind.MIN_FLOOD),
            CurrentEvent(t.plusSeconds(7200), -2.0, CurrentEventKind.MAX_EBB)))
        assertEquals(t.plusSeconds(200), reduced.first().time)
        val reversing = CurrentStation(listOf(HarmonicConstituent("S2", 2.0, 90.0)))
        assertTrue(reversing.events(t, t.plusSeconds(86400)).none { it.kind == CurrentEventKind.MIN_FLOOD || it.kind == CurrentEventKind.MIN_EBB })
    }
    @Test fun directionsRemainOptional() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val cs = listOf(HarmonicConstituent("S2", 1.0, 90.0))
        val s = CurrentStation(cs, floodDirectionDegrees = 450.0)
        for (event in s.events(t, t.plusSeconds(86400))) {
            assertEquals(if (event.kind == CurrentEventKind.MAX_FLOOD) 90.0 else null, event.directionDegrees)
        }
        assertEquals(270.0, CurrentStation(cs, ebbDirectionDegrees = -90.0).ebbDirectionDegrees)
        for (v in listOf(Double.NaN, Double.POSITIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { CurrentStation(cs, v) }
            assertFailsWith<IllegalArgumentException> { CurrentStation(cs, ebbDirectionDegrees = v) }
            assertFailsWith<IllegalArgumentException> { CurrentStation(cs, offsetKnots = v) }
        }
    }
    @Test fun overlappingWindowsKeepSameEventsAndIgnoreDst() {
        val s = fixture("currents-parity").getValue("harmonic").obj().current()
        val from = Instant.parse("2026-11-01T00:00:00Z")
        val to = from.plusSeconds(3 * 86400)
        val all = s.events(from, to)
        val innerFrom = from.plusSeconds(13 * 3600)
        val innerTo = to.minusSeconds(11 * 3600)
        assertEquals(all.filter { it.time >= innerFrom && it.time <= innerTo }, s.events(innerFrom, innerTo))
        assertEquals(all.filter { it.kind == CurrentEventKind.SLACK }, s.slacks(from, to))
        assertEquals(all.filter { it.kind == CurrentEventKind.MAX_FLOOD || it.kind == CurrentEventKind.MAX_EBB }, s.maxima(from, to))
        val original = TimeZone.getDefault()
        try { TimeZone.setDefault(TimeZone.getTimeZone("America/Vancouver")); assertEquals(all, s.events(from, to)) }
        finally { TimeZone.setDefault(original) }
    }
    @Test fun concurrentCallsAgreeAndCopyInputs() {
        val f = fixture("prediction-victoria")
        val inputs = f.constituents().toMutableList()
        val s = CurrentStation(inputs)
        val from = f.instant("start")
        val to = f.instant("end")
        val expected = s.events(from, to)
        val speeds = s.speeds(from, to)
        inputs.clear()
        val pool = Executors.newFixedThreadPool(2)
        try {
            val calls = (1..4).map { pool.submit<List<CurrentEvent>> { s.events(from, to) } }
            for (call in calls) assertEquals(expected, call.get())
            assertEquals(speeds, s.speeds(from, to))
        } finally { pool.shutdownNow() }
    }
}
