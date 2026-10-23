package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*

class ExtremesTest {
    @Test fun extremesMatchVictoria() {
        val f = fixture("extremes-victoria")
        val actual = Station(fixture("prediction-victoria").constituents()).extremes(f.instant("start"), f.instant("end"))
        assertEquals(f.array("extremes").size, actual.size)
        for ((a, item) in actual.zip(f.array("extremes"))) {
            val e = item.obj()
            assertEquals(e.string("kind"), a.kind.name.lowercase())
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 60)
            assertTrue(abs(a.heightMetres - e.number("height")) < 0.02)
        }
    }
    // Cambridge, MD puts the low of 26 July 2026 on 00:00 UTC, a second apart under each day's
    // parameters: it is found once, and the high before it is kept.
    @Test fun aTurnOnUtcMidnightIsFoundOnce() {
        val f = fixture("extremes-midnight")
        val actual = Station(f.constituents()).extremes(f.instant("start"), f.instant("end"))
        assertEquals(f.array("extremes").size, actual.size)
        for ((a, item) in actual.zip(f.array("extremes"))) {
            val e = item.obj()
            assertEquals(e.string("kind"), a.kind.name.lowercase())
            assertTrue(abs(secondsBetween(a.time, e.instant("time"))) < 60)
            assertTrue(abs(a.heightMetres - e.number("height")) < 0.02)
        }
    }
    @Test fun analyticTurnsAndConstantStations() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        val s = Station(listOf(HarmonicConstituent("S2", 1.0, 90.0)))
        val events = s.extremes(t, t.plusSeconds(86400))
        assertEquals(listOf(3.0, 9.0, 15.0, 21.0), events.map { kotlin.math.round(secondsBetween(t, it.time) / 3600) })
        for ((i, e) in events.withIndex()) {
            assertTrue(abs(secondsBetween(t.plusSeconds((3L + i * 6) * 3600), e.time)) < 1)
            assertEquals(if (i % 2 == 0) ExtremeKind.HIGH else ExtremeKind.LOW, e.kind)
        }
        for (station in listOf(Station(emptyList()), Station(emptyList(), 2.0), Station(listOf(HarmonicConstituent("unknown", 1.0, 0.0))))) {
            assertTrue(station.extremes(t, t.plusSeconds(86400)).isEmpty())
        }
        assertTrue(s.extremes(t.plusSeconds(1), t).isEmpty())
    }
    private fun raw(hour: Double, level: Double, high: Boolean) = RawExtreme(Instant.EPOCH.plusSeconds((hour * 3600).toLong()), level, high)
    private fun hourOf(e: RawExtreme) = e.time.epochSecond / 3600.0
    // A tall turn of the other kind on each side decides the list's own ends; the frame itself is dropped.
    private fun framed(list: List<RawExtreme>) = listOf(raw(hourOf(list.first()) - 6, if (list.first().high) -10.0 else 10.0, !list.first().high)) +
        list + raw(hourOf(list.last()) + 6, if (list.last().high) -10.0 else 10.0, !list.last().high)
    @Test fun persistenceRemovesShallowTurnsAndDuplicates() {
        val input = listOf(raw(0.0, 0.0, false), raw(6.0, 1.002, true), raw(7.0, 0.995, false), raw(8.0, 1.0, true), raw(14.0, 0.0, false))
        assertEquals(listOf(0.0, 1.002, 0.0), filterExtremes(framed(input), 0.01).map { it.level })
        assertEquals(input, filterExtremes(framed(input), 0.0))
        val duplicate = listOf(raw(0.0, -0.4, false), raw(7.6, 0.03, true), raw(7.6005, 0.03, true), raw(10.4, -0.008, false))
        assertEquals(listOf(false, true, false), filterExtremes(framed(duplicate), 0.01).map { it.high })
        assertTrue(1.002 !in filterExtremes(input.take(3), 0.01).map { it.level }, "undecided at the end of the list")
    }
    @Test fun persistenceLooksAtMost32DaysFromAnExtreme() {
        fun dipAt(hour: Double) = filterExtremes(listOf(raw(-6.0, -1.0, false), raw(0.0, 0.5, true), raw(6.0, 0.497, false),
            raw(12.0, 0.499, true), raw(hour, 0.4, false), raw(hour + 6, 1.0, true)), 0.01).map { it.level }
        assertTrue(0.5 in dipAt(32.0 * 24 - 1))
        assertTrue(0.5 !in dipAt(32.0 * 24 + 1))
    }
    @Test fun anAnnualTideKeepsItsTurnsMonthsApart() {
        val annual = Station(listOf(HarmonicConstituent("SA", 1.0, 40.0)))
        val start = Instant.parse("2026-01-01T00:00:00Z")
        val end = Instant.parse("2027-01-01T00:00:00Z")
        assertEquals(listOf(ExtremeKind.HIGH, ExtremeKind.LOW), annual.extremes(start, end).map { it.kind })
        assertTrue(annual.extremes(start, end, 0.0).size >= 2, "threshold 0 keeps the raw turns")
    }
    @Test fun extremesDoNotDependOnTheWindow() {
        // A gauge whose every turn is a few millimetres: runs below the 1 cm filter last for days.
        val subCentimetre = Station(listOf(HarmonicConstituent("M2", 0.002, 40.0), HarmonicConstituent("K1", 0.0025, 110.0),
            HarmonicConstituent("O1", 0.0015, 300.0), HarmonicConstituent("S2", 0.001, 75.0)))
        val t0 = Instant.parse("2026-08-01T20:00:00Z")
        for (station in listOf(subCentimetre, Station(fixture("prediction-victoria").constituents()))) {
            val long = station.extremes(t0.minusSeconds(24 * 3600), t0.plusSeconds(96 * 3600))
            assertTrue(long.size > 1, "turns to compare")
            for (offset in listOf(0L, 1, 7, 13, 19)) for (hours in listOf(13L, 30, 48)) {
                val from = t0.plusSeconds(offset * 3600)
                val to = from.plusSeconds(hours * 3600)
                assertEquals(long.filter { it.time >= from && it.time <= to }, station.extremes(from, to), "$hours h from +$offset h")
            }
        }
    }
    @Test fun contextKeepsBoundaryEventsConsistent() {
        val s = Station(listOf(HarmonicConstituent("M2", 1.0, 0.0), HarmonicConstituent("M4", 0.29, 180.5), HarmonicConstituent("M8", 0.001, 0.0)))
        val t = Instant.parse("2025-01-01T00:00:00Z")
        val long = s.extremes(t.minusSeconds(86400), t.plusSeconds(2 * 86400))
        for ((begin, end) in listOf(1L to 10L, 2L to 10L, 6L to 13L, 6L to 14L)) {
            val from = t.plusSeconds(begin * 3600)
            val to = t.plusSeconds(end * 3600)
            val short = s.extremes(from, to)
            val cropped = long.filter { it.time >= from && it.time <= to }
            assertEquals(cropped.map { it.kind }, short.map { it.kind })
            for ((a, b) in short.zip(cropped)) {
                assertTrue(abs(secondsBetween(a.time, b.time)) < 5)
                assertTrue(abs(a.heightMetres - b.heightMetres) < 1e-4)
            }
        }
    }
    @Test fun extremesAlternateOverNineteenYearsOfMixedTide() {
        val mixed = listOf("M2" to 0.37 to 20.0, "S2" to 0.1 to 40.0, "N2" to 0.09 to 355.0, "K2" to 0.03 to 40.0,
            "K1" to 0.63 to 260.0, "O1" to 0.38 to 240.0, "P1" to 0.19 to 258.0, "Q1" to 0.07 to 235.0)
            .map { (np, phase) -> HarmonicConstituent(np.first, np.second, phase) }
        val shallow = listOf(HarmonicConstituent("M4", 0.08, 100.0), HarmonicConstituent("MS4", 0.03, 150.0))
        for (set in listOf(mixed, mixed + shallow)) {
            val got = Station(set).extremes(Instant.parse("2020-01-01T00:00:00Z"), Instant.parse("2039-01-01T00:00:00Z"))
            assertTrue(got.zipWithNext().none { (a, b) -> a.kind == b.kind }, "two of a kind in a row")
        }
    }
    // Knots must surround every window: past the last one the curve would hold flat, rate 0, or fail to bracket.
    @Test fun aSubordinateOfAMicroTidalReferenceKeepsMovingAcrossEveryWindow() {
        val reference = Station(listOf(HarmonicConstituent("M2", 0.002, 40.0), HarmonicConstituent("K1", 0.0025, 110.0),
            HarmonicConstituent("O1", 0.0015, 300.0), HarmonicConstituent("S2", 0.001, 75.0)))
        val subordinate = SubordinateTideStation(reference, 0.0, 0.0, HeightOffset.Ratio(1.0, 1.0))
        val t0 = Instant.parse("2026-01-01T00:00:00Z")
        var rawWindows = 0
        for (hour in 0 until 24 * 60 step 6) {
            val from = t0.plusSeconds(hour * 3600L)
            val to = from.plusSeconds(24 * 3600)
            val rates = subordinate.rates(from, to)
            assertTrue(rates.first().rateMetresPerHour != 0.0 && rates.last().rateMetresPerHour != 0.0, "window from $from")
            // As in Swift, kept extremes that don't surround the window within the 15-hour pad give
            // way to the raw turning points there, and the curve turns at every one of them.
            fun surrounds(e: List<TideExtreme>) = e.size >= 2 && e.first().time <= from && e.last().time >= to
            val padFrom = from.minusSeconds(15 * 3600)
            val padTo = to.plusSeconds(15 * 3600)
            val raw = reference.extremes(padFrom, padTo, 0.0)
            if (surrounds(subordinate.extremes(padFrom, padTo)) || !surrounds(raw)) continue
            val turns = rates.zipWithNext().count { (a, b) -> (a.rateMetresPerHour > 0) != (b.rateMetresPerHour > 0) }
            assertEquals(raw.count { it.time > from && it.time < to }, turns, "window from $from")
            rawWindows++
        }
        assertTrue(rawWindows > 0, "windows drawn from raw turning points")
    }
}
