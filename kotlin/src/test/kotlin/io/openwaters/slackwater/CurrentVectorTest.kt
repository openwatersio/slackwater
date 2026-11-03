package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*

class CurrentVectorTest {
    @Test fun vectorsMatchSharedFixtureAndPreserveEvents() {
        val f = fixture("currents-vector")
        val station = CurrentStation(f.constituents(), f.number("floodDirection"), f.number("ebbDirection"),
            f.number("meanFlow"), f.constituents("minorConstituents"), f.number("minorMeanFlow"), f.number("azimuth"))
        val points = station.speeds(f.instant("start"), f.instant("end"), f.number("timeFidelity"))
        assertEquals(f.array("timeline").size, points.size)
        for ((p, row) in points.zip(f.array("timeline"))) {
            val e = row.obj()
            assertTrue(abs(secondsBetween(p.time, e.instant("time"))) < 0.001)
            assertTrue(abs(p.speedKnots - e.number("speed")) < 1e-6)
            assertTrue(abs(p.magnitudeKnots - e.number("magnitude")) < 1e-6)
            assertTrue(angularDiff(assertNotNull(p.directionDegrees), e.number("direction")) < 1e-5)
        }
        val axial = CurrentStation(f.constituents(), f.number("floodDirection"), f.number("ebbDirection"), f.number("meanFlow"))
        assertEquals(axial.events(f.instant("start"), f.instant("end")), station.events(f.instant("start"), f.instant("end")))
        assertTrue(station.speeds(f.instant("end"), f.instant("start")).isEmpty())
    }

    @Test fun constantVectorsCoverQuadrantsAndWrapping() {
        val from = Instant.parse("2026-01-01T00:00:00Z")
        val rows = listOf(listOf(3.0, 4.0, 0.0, 5.0, 53.13010235415598), listOf(-3.0, 4.0, 0.0, 5.0, 126.86989764584402),
            listOf(-3.0, -4.0, 0.0, 5.0, 233.13010235415598), listOf(3.0, -4.0, 0.0, 5.0, 306.86989764584405),
            listOf(0.0, 4.0, -90.0, 4.0, 0.0), listOf(0.0, -4.0, 450.0, 4.0, 0.0))
        for ((u, v, azi, magnitude, bearing) in rows) {
            val s = CurrentStation(emptyList(), offsetKnots = u, minorOffsetKnots = v, azimuthDegrees = azi)
            val p = s.speeds(from, from.plusSeconds(3600)).first()
            assertEquals(u, p.speedKnots)
            assertEquals(magnitude, p.magnitudeKnots)
            assertTrue(angularDiff(assertNotNull(p.directionDegrees), bearing) < 1e-10)
        }
        for (invalid in listOf(Double.NaN, Double.POSITIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { CurrentStation(emptyList(), minorOffsetKnots = invalid) }
            assertFailsWith<IllegalArgumentException> { CurrentStation(emptyList(), azimuthDegrees = invalid) }
        }
    }

    @Test fun axialFallbacksRespectUnknownBearingsAndZeroVectors() {
        val from = Instant.parse("2026-01-01T00:00:00Z")
        fun point(s: CurrentStation) = s.speeds(from, from.plusSeconds(3600)).first()
        assertEquals(30.0, point(CurrentStation(emptyList(), 30.0, 225.0, 2.0)).directionDegrees)
        assertEquals(225.0, point(CurrentStation(emptyList(), 30.0, 225.0, -2.0)).directionDegrees)
        for (minor in listOf(emptyList(), listOf(HarmonicConstituent("UNKNOWN", 1.0, 0.0)), listOf(HarmonicConstituent("M2", 0.0, 0.0)))) {
            assertEquals(225.0, point(CurrentStation(emptyList(), 30.0, 225.0, -2.0, minor)).directionDegrees)
        }
        assertNull(point(CurrentStation(emptyList(), 30.0, offsetKnots = -2.0)).directionDegrees)
        assertNull(point(CurrentStation(emptyList(), offsetKnots = 2.0)).directionDegrees)
        val unknown = point(CurrentStation(emptyList(), offsetKnots = 3.0, minorOffsetKnots = 4.0))
        assertEquals(5.0, unknown.magnitudeKnots)
        assertNull(unknown.directionDegrees)
        val zero = point(CurrentStation(emptyList(), 30.0, 225.0))
        assertEquals(0.0, zero.magnitudeKnots)
        assertNull(zero.directionDegrees)
        assertNull(point(CurrentStation(emptyList(), 30.0, 225.0, minorConstituents = emptyList())).directionDegrees)
        val synthesized = CurrentPoint(from, -3.0)
        assertEquals(3.0, synthesized.magnitudeKnots)
        assertNull(synthesized.directionDegrees)
    }

    @Test fun subordinatesUseOwnPhaseBearings() {
        val from = Instant.parse("2026-01-01T00:00:00Z")
        val ref = CurrentStation(listOf(HarmonicConstituent("S2", 2.0, 0.0)), minorOffsetKnots = 1.0)
        for (known in listOf(true, false)) {
            val sub = SubordinateCurrentStation(ref, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0,
                if (known) 30.0 else null, if (known) 225.0 else null)
            for (p in sub.speeds(from, from.plusSeconds(86400))) {
                assertEquals(abs(p.speedKnots), p.magnitudeKnots)
                assertEquals(if (!known || p.speedKnots == 0.0) null else if (p.speedKnots > 0) 30.0 else 225.0, p.directionDegrees)
            }
        }
    }
}
