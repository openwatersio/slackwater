package io.openwaters.slackwater

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

// Mirrors packages/engine/test/readings/{series,current,tide}.test.ts and the Swift ReadingsTests,
// then checks parity with fixtures/readings.json from the TypeScript engine.
class ReadingsTest {
    private val t0 = Instant.parse("2026-10-10T00:00:00Z")
    private val h = 3600.0
    private val m = 60.0
    private fun at(seconds: Double): Instant = t0.plusNanos((seconds * 1e9).roundToLong())
    private fun seconds(time: Instant?): Double = time?.let { secondsBetween(t0, it) } ?: Double.NaN

    /** One sine cycle per 12 h at 3 kn, sampled every 10 minutes for a day. */
    private val sine = (0 until 145).map { CurrentPoint(at(it * 600.0), 3 * sin(2 * PI * it / 72)) }
    private val sineEvents = listOf(
        CurrentEvent(at(3 * h), 3.0, CurrentEventKind.MAX_FLOOD),
        CurrentEvent(at(6 * h), 0.0, CurrentEventKind.SLACK),
        CurrentEvent(at(9 * h), -3.0, CurrentEventKind.MAX_EBB),
    )
    /** Ten-minute one-axis samples from t0 with the given speeds. */
    private fun series(vararg speeds: Double) = speeds.mapIndexed { i, s -> CurrentPoint(at(i * 10 * m), s) }
    private fun slackAt(time: Instant) = CurrentEvent(time, 0.0, CurrentEventKind.SLACK)
    /** A vector sample `hours` after t0. */
    private fun point(hours: Double, speed: Double, magnitude: Double, direction: Double? = null) =
        CurrentPoint(at(hours * h), speed, magnitude, direction)
    private fun near(a: Double?, b: Double, tolerance: Double = 1e-6) = a != null && abs(a - b) < tolerance

    @Test fun interpolationReadsAtAndBetweenSamplesOnly() {
        val heights = listOf(0.0, 1.0, 2.0, 2.0).zip(listOf(0.0, 2.0, 2.0, 6.0)).map { (t, v) -> TidePoint(at(t * h), v) }
        assertEquals(0.5, heights.heightAt(at(0.25 * h)))
        assertNull(heights.heightAt(at(-0.001)))
        assertNull(heights.heightAt(at(3 * h)))
        assertNull(emptyList<TidePoint>().heightAt(t0))
        // The first of two samples sharing an instant.
        assertEquals(2.0, heights.heightAt(at(2 * h)))
        val only = listOf(TidePoint(t0, 2.0))
        assertEquals(2.0, only.heightAt(t0))
        assertNull(only.heightAt(at(0.001)))
        // Sub-millisecond instants are still outside.
        assertNull(only.heightAt(t0.plusNanos(1)))

        assertTrue(near(sine.speedAt(at(300.0)), (sine[0].speedKnots + sine[1].speedKnots) / 2, 1e-12))
        assertNull(sine.speedAt(at(-0.001)))
        assertNull(emptyList<CurrentPoint>().speedAt(t0))
        assertEquals(sine[0].speedKnots, listOf(sine[0], sine[0]).speedAt(t0))

        val rates = listOf(TideRatePoint(t0, 1.0), TideRatePoint(at(h), 2.0))
        assertEquals(1.5, rates.rateAt(at(0.5 * h)))
        assertNull(rates.rateAt(at(h + 0.001)))
    }

    @Test fun vectorsInterpolateThroughBearings() {
        // Through north rather than turning south.
        val north = assertNotNull(listOf(point(0.0, 1.0, 1.0, 350.0), point(1.0, 1.0, 1.0, 10.0)).vectorAt(at(h / 2), null, null))
        assertTrue(near(north.magnitudeKnots, 0.984807753))
        assertTrue(angularDiff(assertNotNull(north.directionDegrees), 0.0) < 1e-9)
        // Opposite vectors cancel without inventing a set.
        val cancel = assertNotNull(listOf(point(0.0, 1.0, 1.0, 90.0), point(1.0, -1.0, 1.0, 270.0)).vectorAt(at(h / 2), null, null))
        assertTrue(cancel.magnitudeKnots < 1e-9)
        assertNull(cancel.directionDegrees)
        // From a zero vector with no bearing.
        val fromZero = listOf(point(0.0, 0.0, 0.0), point(1.0, 1.0, 1.0, 90.0))
        assertEquals(CurrentVector(0.0, null), fromZero.vectorAt(t0, null, null))
        assertEquals(CurrentVector(0.5, 90.0), fromZero.vectorAt(at(h / 2), null, null))
        // A known endpoint beside an unknown one keeps speed without a set.
        val unknown = listOf(point(0.0, 1.0, 2.0, 90.0), point(1.0, 1.0, 3.0))
        assertEquals(CurrentVector(2.0, 90.0), unknown.vectorAt(t0, null, null))
        assertEquals(CurrentVector(2.5, null), unknown.vectorAt(at(h / 2), null, null))
        assertEquals(CurrentVector(3.0, null), unknown.vectorAt(at(h), null, null))
        val unknownFirst = listOf(point(0.0, 1.0, 3.0), point(1.0, 1.0, 2.0, 90.0))
        assertEquals(CurrentVector(2.5, null), unknownFirst.vectorAt(at(h / 2), null, null))
        // Into a zero vector, the set holds while the speed falls.
        val toZero = assertNotNull(listOf(point(0.0, 1.0, 1.0, 90.0), point(1.0, 0.0, 0.0)).vectorAt(at(h / 2), null, null))
        assertTrue(near(toZero.magnitudeKnots, 0.5))
        assertTrue(near(toZero.directionDegrees, 90.0, 1e-9))
        // An engine one-axis point beside a vector sample interpolates as vectors.
        val mixed = assertNotNull(listOf(point(0.0, 1.0, 1.0, 0.0), point(1.0, 1.0, 2.0, 0.0)).vectorAt(at(h / 2), null, null))
        assertTrue(near(mixed.magnitudeKnots, 1.5))
        assertTrue(angularDiff(assertNotNull(mixed.directionDegrees), 0.0) < 1e-9)
        // A vector sample beside a one-axis one reads as one axis with the published set.
        val toScalar = listOf(point(0.0, 1.0, 2.0, 90.0), CurrentPoint(at(h), -1.0))
        assertEquals(CurrentVector(0.5, 45.0), toScalar.vectorAt(at(h / 4), 45.0, 200.0))
        // The lower of two samples sharing an instant.
        val shared = listOf(point(0.0, 1.0, 2.0, 90.0), point(0.0, -1.0, 3.0, 270.0))
        assertEquals(CurrentVector(2.0, 90.0), shared.vectorAt(t0, null, null))
        // Outside the series, or none at all.
        val pair = listOf(point(0.0, 1.0, 1.0, 350.0), point(1.0, 1.0, 1.0, 10.0))
        assertNull(pair.vectorAt(at(-0.001), null, null))
        assertNull(pair.vectorAt(at(h + 0.001), null, null))
        assertNull(emptyList<CurrentPoint>().vectorAt(t0, null, null))
    }

    @Test fun oneAxisSamplesKeepNonreciprocalBearings() {
        for (sign in listOf(1.0, -1.0)) {
            // Engine one-axis points carry their bearing; caller-built ones take the published set.
            val engine = listOf(point(0.0, 0.3 * sign, 0.3, if (sign > 0) 45.0 else 200.0),
                point(1.0, -0.3 * sign, 0.3, if (sign > 0) 200.0 else 45.0))
            val scalar = listOf(CurrentPoint(t0, 0.3 * sign), CurrentPoint(at(h), -0.3 * sign))
            for (timeline in listOf(engine, scalar)) {
                val zero = assertNotNull(timeline.vectorAt(at(h / 2), 45.0, 200.0))
                assertEquals(0.0, zero.magnitudeKnots)
                assertNull(zero.directionDegrees)
                val before = assertNotNull(timeline.vectorAt(at(0.4 * h), 45.0, 200.0))
                assertTrue(near(before.magnitudeKnots, 0.06))
                assertEquals(if (sign > 0) 45.0 else 200.0, before.directionDegrees)
                val after = assertNotNull(timeline.vectorAt(at(0.6 * h), 45.0, 200.0))
                assertTrue(near(after.magnitudeKnots, 0.06))
                assertEquals(if (sign > 0) 200.0 else 45.0, after.directionDegrees)
            }
            assertEquals(CurrentVector(0.3, if (sign > 0) 200.0 else 45.0), scalar.vectorAt(at(h), 45.0, 200.0))
        }
        // Older sources: absolute signed speed, the phase's set, none at zero.
        assertTrue(near(sine.vectorAt(at(8 * h), null, 200.0)?.magnitudeKnots, 2.598076211353316))
        assertEquals(200.0, sine.vectorAt(at(8 * h), null, 200.0)?.directionDegrees)
        assertNull(sine.vectorAt(at(2 * h), null, null)?.directionDegrees)
        val slack = assertNotNull(sine.vectorAt(at(6 * h), 45.0, 225.0))
        assertTrue(slack.magnitudeKnots < 1e-9)
        assertNull(slack.directionDegrees)
    }

    @Test fun readCurrentNamesThePhase() {
        val crossflow = listOf(point(0.0, 0.0, 2.0, 90.0), point(1.0, -1.0, 2.0, 120.0))
        assertEquals(CurrentReading(CurrentState.SLACK, 0.0, 2.0, 90.0), readCurrent(t0, crossflow, listOf(slackAt(t0)), 0.0, 180.0))
        assertEquals(CurrentState.SLACK, readCurrent(at(6 * h), sine, sineEvents, 45.0, 225.0)?.state)
        assertEquals(CurrentState.SLACK, readCurrent(at(6 * h + 1), sine, sineEvents, 45.0, 225.0)?.state)
        assertEquals(CurrentState.SLACK, readCurrent(at(6 * h - 1), sine, sineEvents, 45.0, 225.0)?.state)
        assertEquals(CurrentState.EBBING, readCurrent(at(6 * h + 1.001), sine, sineEvents, 45.0, 225.0)?.state)
        assertEquals(CurrentState.FLOODING, readCurrent(at(6 * h - 1.001), sine, sineEvents, 45.0, 225.0)?.state)
        val flood = assertNotNull(readCurrent(at(3 * h - 1), sine, sineEvents, 45.0, 225.0))
        assertEquals(CurrentState.MAX_FLOOD, flood.state)
        assertEquals(45.0, flood.directionDegrees)
        assertEquals(CurrentState.MAX_EBB, readCurrent(at(9 * h), sine, sineEvents, 45.0, 225.0)?.state)
        val weak = CurrentEvent(at(10 * m), 0.2, CurrentEventKind.MAX_FLOOD)
        assertEquals(CurrentState.MAX_FLOOD, readCurrent(at(10 * m), series(0.1, 0.2, 0.1), listOf(weak), 45.0, 225.0)?.state)
        val before = assertNotNull(readCurrent(at(6 * h - 5 * m), sine, sineEvents, 45.0, 225.0))
        assertEquals(CurrentState.FLOODING, before.state)
        assertEquals(45.0, before.directionDegrees)
        val after = assertNotNull(readCurrent(at(6 * h + 5 * m), sine, sineEvents, 45.0, 225.0))
        assertEquals(CurrentState.EBBING, after.state)
        assertEquals(225.0, after.directionDegrees)
        val ebb = assertNotNull(readCurrent(at(8 * h), sine, sineEvents, 45.0, 200.0))
        assertEquals(200.0, ebb.directionDegrees)
        assertEquals("south-southwest", SPOKEN_COMPASS_POINTS[compassIndex(200.0)])
        assertNull(readCurrent(at(2 * h), sine, sineEvents, null, null)?.directionDegrees)
        assertNull(readCurrent(at(-h), sine, sineEvents, 45.0, 225.0))
        assertNotNull(readCurrent(sine[0].time, sine, sineEvents, null, null))
        assertNotNull(readCurrent(sine[144].time, sine, sineEvents, null, null))
        assertNull(readCurrent(sine[144].time.plusMillis(1), sine, sineEvents, null, null))
    }

    @Test fun compassPointsNameBearings() {
        assertEquals("N", compassPoint(0.0))
        assertEquals("N", compassPoint(349.0))
        assertEquals("NNE", compassPoint(22.5))
        assertEquals("SW", compassPoint(225.0))
        assertEquals("W", compassPoint(-90.0))
        assertEquals("N", compassPoint(-11.25))
        assertEquals("NNE", compassPoint(371.25))
        assertEquals("N", compassPoint(Double.NaN))
        assertEquals(0, compassIndex(Double.POSITIVE_INFINITY))
        assertEquals("north-northeast", SPOKEN_COMPASS_POINTS[compassIndex(22.5)])
        assertEquals(16, COMPASS_POINTS.size)
        assertEquals(16, SPOKEN_COMPASS_POINTS.size)
    }

    @Test fun slackWindowSpansTheBand() {
        assertEquals(0.5, DEFAULT_SLACK_THRESHOLD_KNOTS)
        // |3 sin θ| ≤ 0.5 within asin(1/6) of the reversal: about 19 minutes each side.
        val w = assertNotNull(slackWindowAround(sine, at(6 * h), 0.5))
        val half = asin(1.0 / 6) / (2 * PI) * 12 * h
        assertTrue(abs((6 * h - seconds(w.start)) - half) < 30)
        assertTrue(abs((seconds(w.end) - 6 * h) - half) < 30)
        // A signed band crossing across a reversal matches iOS.
        for (direction in listOf(-1.0, 1.0)) {
            val s = assertNotNull(slackWindowAround(series(-1 * direction, 0.1 * direction, 1 * direction), at(545.45), 0.15))
            assertTrue(abs(seconds(s.start) - 463.64) < 0.05)
            assertTrue(abs(seconds(s.end) - 633.33) < 0.05)
        }
        // A reversal between two out-of-band samples crosses the band along the segment.
        assertEquals(SlackWindow(at(12.5 * m), at(17.5 * m)), slackWindowAround(series(2.0, 1.0, -1.0, -2.0), at(15 * m), 0.5))
        val later = assertNotNull(slackWindowAround(series(2.0, 1.0, 0.25, -1.0, -2.0), at(22 * m), 0.5))
        assertTrue(abs(seconds(later.start) - (10 * m + 10 * m * 0.5 / 0.75)) < 1e-6)
        assertTrue(abs(seconds(later.end) - 26 * m) < 1e-6)
        // Widens to hold its slack.
        val wide = assertNotNull(slackWindowAround(series(2.0, 1.0, -3.0, -4.0), at(19 * m), 0.5))
        assertTrue(abs(seconds(wide.start) - 11.25 * m) < 1e-6)
        assertEquals(at(19 * m), wide.end)
        assertEquals(at(6 * m), slackWindowAround(series(0.3, -3.0), at(6 * m), 0.5)?.end)
        // A crossing keeps its sub-second instant.
        val fine = assertNotNull(slackWindowAround(series(0.0, 3.0), t0, 0.5))
        assertEquals(t0.plusNanos(100_000_000_000), fine.end)
        val odd = assertNotNull(slackWindowAround(series(0.0, 0.7), t0, 0.5))
        assertEquals(t0.plusNanos(428_571_428_571), odd.end)
        // Clamped to the series.
        assertEquals(SlackWindow(t0, at(10 * m)), slackWindowAround(series(0.2, -0.3), at(4 * m), 0.5))
        // None outside the series, without a band or a reversal, or at a threshold at or below zero.
        assertNull(slackWindowAround(series(2.0, 1.0), at(-0.001), 0.5))
        assertNull(slackWindowAround(series(2.0, 1.0), at(10 * m + 0.001), 0.5))
        assertNull(slackWindowAround(emptyList(), t0, 0.5))
        assertNull(slackWindowAround(series(2.0, 1.0, 2.0), at(5 * m), 0.5))
        assertNull(slackWindowAround(series(2.0, 1.0), at(10 * m), 0.5))
        assertNull(slackWindowAround(sine, at(6 * h), 0.0))
        assertNull(slackWindowAround(sine, at(6 * h), -1.0))
    }

    @Test fun mergeWindowsJoinsTouchingWindows() {
        val windows = listOf(SlackWindow(at(0.0), at(10.0)), SlackWindow(at(10.0), at(20.0)),
            SlackWindow(at(12.0), at(15.0)), SlackWindow(at(30.0), at(40.0)))
        assertEquals(listOf(SlackWindow(at(0.0), at(20.0)), SlackWindow(at(30.0), at(40.0))), mergeWindows(windows))
        assertEquals(emptyList(), mergeWindows(emptyList()))
    }

    @Test fun slackRunsMergeWindowsAroundSlacks() {
        val shared = slackRuns(series(1.0, 0.2, -0.2, 0.2, -0.2, -1.0),
            listOf(slackAt(at(15 * m)), slackAt(at(25 * m)), slackAt(at(35 * m))), 0.5)
        assertEquals(1, shared.size)
        assertTrue(shared[0].start < at(10 * m) && shared[0].end > at(40 * m))
        val tail = slackRuns(series(2.0, 1.0, -3.0, -4.0), listOf(slackAt(at(12 * m)), slackAt(at(19 * m))), 0.5).first()
        assertTrue(abs(seconds(tail.start) - 11.25 * m) < 1e-6)
        assertEquals(at(19 * m), tail.end)
        assertEquals(2, slackRuns(sine, sineEvents + listOf(slackAt(at(12 * h)), slackAt(at(-h))), 0.5).size)
        assertEquals(listOf(SlackWindow(at(5 * m), at(5 * m))), slackRuns(series(2.0, 1.0, 2.0), listOf(slackAt(at(5 * m))), 0.5))
        assertEquals(listOf(SlackWindow(at(6 * h), at(6 * h))), slackRuns(sine, sineEvents, 0.0))
        assertEquals(emptyList(), slackRuns(emptyList(), sineEvents, 0.5))
        // Sorted by start before merging, whatever the event order.
        val sorted = slackRuns(series(0.2, 2.0, 2.0, 0.2), listOf(slackAt(at(30 * m)), slackAt(t0)), 0.5)
        assertEquals(2, sorted.size)
        assertEquals(t0, sorted[0].start)
        assertEquals(at(30 * m), sorted[1].end)
    }

    /** Hourly tide samples from t0 with the given heights. */
    private fun tide(vararg heights: Double) = heights.mapIndexed { i, v -> TidePoint(at(i * h), v) }
    private fun turn(hours: Double, height: Double, high: Boolean) =
        TideExtreme(at(hours * h), height, if (high) ExtremeKind.HIGH else ExtremeKind.LOW)
    private fun rate(value: Double, i: Int) = TideRatePoint(at(i * h), value)

    @Test fun ratesAreSampledCentralDifferences() {
        val rates = tide(0.0, 1.0, 3.0, 3.5).sampledRates()
        assertEquals(listOf(1.0, 1.5, 1.25, 0.5), rates.map { it.rateMetresPerHour })
        assertEquals(at(h), rates[1].time)
        assertEquals(listOf(0.0), tide(2.0).sampledRates().map { it.rateMetresPerHour })
        assertEquals(listOf(0.0, 0.0), listOf(TidePoint(t0, 1.0), TidePoint(t0, 2.0)).sampledRates().map { it.rateMetresPerHour })
        assertTrue(tide().sampledRates().isEmpty())
        assertTrue(near(tide(0.0, 1.0, 3.0).sampledRates().rateAt(at(0.5 * h)), 1.25))
    }

    @Test fun flowPeaksTakeEachRunsFastestSample() {
        val rates = listOf(0.2, 0.7, 0.9, 0.4, -0.3, -0.5, -0.1, 0.65, 0.6).mapIndexed { i, r -> rate(r, i) }
        assertEquals(listOf(rate(0.9, 2), rate(0.65, 7)), flowPeaks(rates, 0.6))
        assertEquals(listOf(rate(0.8, 0), rate(1.2, 2)), flowPeaks(listOf(0.8, 0.0, 1.2).mapIndexed { i, r -> rate(r, i) }, 0.6))
        assertEquals(listOf(rate(-1.1, 1)), flowPeaks(listOf(-0.7, -1.1, -0.9).mapIndexed { i, r -> rate(r, i) }, 0.6))
        assertEquals(listOf(true, false), flowPeaks(tide(0.0, 0.1, 0.3, 0.2, 0.0).sampledRates(), 0.0).map { it.rateMetresPerHour > 0 })
        assertEquals(emptyList(), flowPeaks(emptyList(), 0.6))
        val window = tide(5.0, 1.0, 4.0, 9.0)
        assertEquals(HeightRange(1.0, 4.0), window.heightRange(at(h), at(2 * h)))
        assertEquals(HeightRange(1.0, 5.0), window.heightRange(t0, at(h)))
        assertNull(window.heightRange(at(10 * h), at(11 * h)))
    }

    @Test fun readTideNamesTheTurnOrTheTrend() {
        val flat = tide(1.0, 1.0, 1.0)
        val still = assertNotNull(readTide(at(h), flat, flat.sampledRates(), emptyList()))
        assertEquals(TideState.RISING, still.state)
        assertEquals(0.0, still.rateMetresPerHour)
        val heights = tide(1.0, 2.0, 3.0, 2.0, 1.0, 0.0, 1.0)
        val rates = heights.sampledRates()
        val extremes = listOf(turn(2.0, 3.04, true), turn(5.0, -0.02, false))
        val high = assertNotNull(readTide(at(2 * h + 1), heights, rates, extremes))
        assertEquals(TideState.HIGH, high.state)
        assertEquals(3.04, high.heightMetres)
        assertTrue(high.rising)
        assertTrue(near(high.rateMetresPerHour, -1.0 / 3600, 1e-12))
        assertEquals(TideState.LOW, readTide(at(5 * h - 1), heights, rates, extremes)?.state)
        assertEquals(TideState.FALLING, readTide(at(2 * h + 1.001), heights, rates, extremes)?.state)
        assertEquals(TideReading(TideState.RISING, 1.5, true, 1.0), readTide(at(0.5 * h), heights, rates, extremes))
        val falling = assertNotNull(readTide(at(3.5 * h), heights, rates, extremes))
        assertEquals(TideState.FALLING, falling.state)
        assertFalse(falling.rising)
        // Without a later turn, the sampled rate decides.
        val drop = tide(1.0, 0.8, 0.6)
        for (turns in listOf(emptyList(), listOf(turn(0.0, 1.0, true)))) {
            val r = assertNotNull(readTide(at(h), drop, drop.sampledRates(), turns))
            assertEquals(TideState.FALLING, r.state)
            assertFalse(r.rising)
            assertEquals(0.8, r.heightMetres)
            assertTrue(near(r.rateMetresPerHour, -0.2))
        }
        assertEquals(TideState.RISING, readTide(at(5.5 * h), heights, rates, extremes)?.state)
        assertNull(readTide(at(-0.001), heights, rates, extremes))
        assertNotNull(readTide(t0, heights, rates, extremes))
        assertNotNull(readTide(at(6 * h), heights, rates, extremes))
        assertNull(readTide(at(6 * h + 0.001), heights, rates, extremes))
        // No rate to read, no reading.
        assertNull(readTide(at(h), heights, emptyList(), extremes))
    }

    @Test fun maxSpeedsSwingHeightsAndRanks() {
        val maxima = listOf(CurrentEvent(t0, 4.2, CurrentEventKind.MAX_FLOOD),
            CurrentEvent(at(3 * h), 0.0, CurrentEventKind.SLACK),
            CurrentEvent(at(6 * h), -6.4, CurrentEventKind.MAX_EBB))
        assertEquals(listOf(6.4), maxima.maxSpeeds(CurrentEventKind.MAX_EBB))
        assertEquals(listOf(4.2), maxima.maxSpeeds(CurrentEventKind.MAX_FLOOD))
        assertEquals(listOf(3.0, 2.0), listOf(turn(0.0, 0.0, false), turn(6.0, 3.0, true), turn(12.0, 1.0, false)).swingHeights())
        assertEquals(listOf(2.5), listOf(turn(0.0, 1.0, false), turn(3.0, 0.5, false), turn(6.0, 3.0, true)).swingHeights())
        assertEquals(listOf(2.5), listOf(turn(0.0, 0.5, false), turn(3.0, 1.0, false), turn(6.0, 3.0, true)).swingHeights())
        assertEquals(listOf(2.0, 2.0), listOf(turn(0.0, 0.0, false), turn(3.0, 2.0, true), turn(6.0, 3.0, true), turn(9.0, 1.0, false)).swingHeights())
        assertEquals(listOf(3.0, 1.0), listOf(turn(0.0, 0.0, false), turn(3.0, 3.0, true), turn(6.0, 2.0, true), turn(9.0, 2.0, false)).swingHeights())
        assertEquals(emptyList(), listOf(turn(0.0, 2.0, false), turn(6.0, 1.0, true)).swingHeights())
        assertEquals(emptyList(), listOf(turn(0.0, 2.0, true), turn(6.0, 2.0, false)).swingHeights())
        assertEquals(emptyList(), emptyList<TideExtreme>().swingHeights())
        assertEquals(emptyList(), listOf(turn(0.0, 1.0, true)).swingHeights())
        assertNull(emptyList<Double>().percentileRank(1.0))
        assertEquals(1.0, listOf(2.0).percentileRank(2.0))
        assertEquals(0.0, listOf(2.0).percentileRank(1.0))
        assertEquals(0.75, listOf(1.0, 2.0, 2.0, 3.0).percentileRank(2.0))
    }

    private fun currentState(name: String) = when (name) {
        "Slack" -> CurrentState.SLACK
        "Max flood" -> CurrentState.MAX_FLOOD
        "Max ebb" -> CurrentState.MAX_EBB
        "Flooding" -> CurrentState.FLOODING
        "Ebbing" -> CurrentState.EBBING
        else -> error("Invalid fixture state: $name")
    }
    private fun tideState(name: String) = when (name) {
        "High" -> TideState.HIGH
        "Low" -> TideState.LOW
        "Rising" -> TideState.RISING
        "Falling" -> TideState.FALLING
        else -> error("Invalid fixture state: $name")
    }
    private fun JsonObject.optionalNumber(key: String) = get(key)?.jsonPrimitive?.doubleOrNull
    private fun JsonObject.event() = CurrentEvent(instant("time"), number("speed"), currentKind(string("kind")))
    private fun sameTime(a: Instant, b: Instant) = abs(secondsBetween(a, b)) < 0.5

    private fun checkCurrent(expected: JsonArray, timeline: List<CurrentPoint>, events: List<CurrentEvent>, flood: Double, ebb: Double) {
        for (row in expected) {
            val e = row.obj()
            val label = e.string("time")
            val r = assertNotNull(readCurrent(e.instant("time"), timeline, events, flood, ebb), label)
            assertEquals(currentState(e.string("state")), r.state, label)
            assertTrue(abs(r.speedKnots - e.number("speed")) < 1e-6, label)
            assertTrue(abs(r.magnitudeKnots - e.number("magnitude")) < 1e-6, label)
            val direction = e.optionalNumber("direction")
            if (direction == null) assertNull(r.directionDegrees, label)
            else assertTrue(angularDiff(assertNotNull(r.directionDegrees, label), direction) < 1e-5, label)
        }
    }

    @Test fun readingsMatchSharedFixture() {
        val f = fixture("readings")

        val v = f.getValue("vector").obj()
        val timeline = v.array("timeline").map {
            val p = it.obj()
            CurrentPoint(p.instant("time"), p.number("speed"), p.number("magnitude"), p.optionalNumber("direction"))
        }
        val events = v.array("events").map { it.obj().event() }
        val threshold = v.number("threshold")
        assertEquals(79, v.array("readings").size)
        checkCurrent(v.array("readings"), timeline, events, v.number("floodDirection"), v.number("ebbDirection"))
        val windows = events.filter { it.kind == CurrentEventKind.SLACK }.mapNotNull { e ->
            slackWindowAround(timeline, e.time, threshold)?.let { e.time to it }
        }
        assertEquals(8, v.array("windows").size)
        assertEquals(v.array("windows").size, windows.size)
        for ((actual, row) in windows.zip(v.array("windows"))) {
            val e = row.obj()
            assertTrue(sameTime(actual.first, e.instant("slack")), e.string("slack"))
            assertTrue(sameTime(actual.second.start, e.instant("start")), e.string("slack"))
            assertTrue(sameTime(actual.second.end, e.instant("end")), e.string("slack"))
        }
        val runs = slackRuns(timeline, events, threshold)
        assertEquals(5, v.array("runs").size)
        assertEquals(v.array("runs").size, runs.size)
        for ((actual, row) in runs.zip(v.array("runs"))) {
            val e = row.obj()
            assertTrue(sameTime(actual.start, e.instant("start")) && sameTime(actual.end, e.instant("end")), e.string("start"))
        }

        val s = f.getValue("scalar").obj()
        assertEquals(4, s.array("readings").size)
        checkCurrent(s.array("readings"), s.array("timeline").map { CurrentPoint(it.obj().instant("time"), it.obj().number("speed")) },
            s.array("events").map { it.obj().event() }, s.number("flood"), s.number("ebb"))

        val t = f.getValue("tide").obj()
        val heights = t.array("timeline").map { TidePoint(it.obj().instant("time"), it.obj().number("level")) }
        val extremes = t.array("extremes").map {
            val e = it.obj()
            TideExtreme(e.instant("time"), e.number("level"),
                if (e.getValue("high").jsonPrimitive.boolean) ExtremeKind.HIGH else ExtremeKind.LOW)
        }
        val fixtureRates = t.array("rates").map { TideRatePoint(it.obj().instant("time"), it.obj().number("rate")) }
        val rates = heights.sampledRates()
        assertEquals(289, fixtureRates.size)
        assertEquals(fixtureRates.size, rates.size)
        for ((actual, expected) in rates.zip(fixtureRates)) {
            assertTrue(sameTime(actual.time, expected.time), expected.time.toString())
            assertTrue(abs(actual.rateMetresPerHour - expected.rateMetresPerHour) < 1e-6, expected.time.toString())
        }
        val peaks = flowPeaks(fixtureRates, 0.6)
        assertEquals(4, t.array("peaks").size)
        assertEquals(t.array("peaks").size, peaks.size)
        for ((actual, row) in peaks.zip(t.array("peaks"))) {
            val e = row.obj()
            assertTrue(sameTime(actual.time, e.instant("time")) && abs(actual.rateMetresPerHour - e.number("rate")) < 1e-6, e.string("time"))
        }
        assertEquals(57, t.array("readings").size)
        for (row in t.array("readings")) {
            val e = row.obj()
            val label = e.string("time")
            val r = assertNotNull(readTide(e.instant("time"), heights, fixtureRates, extremes), label)
            assertEquals(tideState(e.string("state")), r.state, label)
            assertEquals(e.getValue("up").jsonPrimitive.boolean, r.rising, label)
            assertTrue(abs(r.heightMetres - e.number("level")) < 1e-6, label)
            assertTrue(abs(r.rateMetresPerHour - e.number("rate")) < 1e-6, label)
        }
        val swings = extremes.swingHeights()
        val expectedSwings = t.array("swings").map { it.jsonPrimitive.double }
        assertEquals(7, expectedSwings.size)
        assertEquals(expectedSwings.size, swings.size)
        for ((actual, expected) in swings.zip(expectedSwings)) assertTrue(abs(actual - expected) < 1e-6)
        assertEquals(7, t.array("ranks").size)
        for (row in t.array("ranks")) {
            val r = row.obj()
            assertTrue(near(swings.percentileRank(r.number("value")), r.number("rank")))
        }
    }
}
