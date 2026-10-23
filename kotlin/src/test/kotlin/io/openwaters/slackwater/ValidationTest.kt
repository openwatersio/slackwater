package io.openwaters.slackwater

import java.time.Instant
import kotlin.test.*

class ValidationTest {
    private val t = Instant.parse("2026-01-01T00:00:00Z")
    @Test fun acceptedSubsecondStepsAlwaysAdvance() {
        val s = Station(emptyList())
        assertFailsWith<IllegalArgumentException> { s.heights(t, t.plusNanos(1000), 1.3e-7) }
        val points = s.heights(t, t.plusNanos(1000), Math.ulp(epochSeconds(t)))
        assertTrue(points.zipWithNext().all { (a, b) -> a.time < b.time })
        assertTrue(points.first().time <= t && points.last().time >= t.plusNanos(1000))
        val fractional = s.heights(t.plusNanos(200), t.plusNanos(1000), Math.ulp(epochSeconds(t)))
        assertTrue(fractional.first().time <= t.plusNanos(200) && fractional.last().time >= t.plusNanos(1000))
    }
    @Test fun oversizedEventSearchesFailPromptly() {
        val classpath = listOf(Station::class.java, RangeProbe::class.java, kotlin.Unit::class.java)
            .map { java.io.File(it.protectionDomain.codeSource.location.toURI()).path }
            .joinToString(java.io.File.pathSeparator)
        val failures = mutableListOf<String>()
        for (kind in listOf("tide", "current")) {
            val process = ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp", classpath, RangeProbe::class.java.name, kind).start()
            val exited = process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)
            if (!exited) process.destroyForcibly().waitFor()
            if (!exited) failures += "$kind event range was not rejected before scanning"
            else if (process.exitValue() != 0) failures += "$kind: ${process.errorStream.bufferedReader().readText()}"
        }
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }
    @Test fun invalidStepsAndOverflowFail() {
        val s = Station(emptyList())
        for (step in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY, 1e-12)) {
            assertFailsWith<IllegalArgumentException> { s.heights(t, t.plusSeconds(1), step) }
        }
        assertFailsWith<IllegalArgumentException> { s.heights(Instant.MIN, Instant.MAX) }
        assertFailsWith<IllegalArgumentException> { s.heights(Instant.EPOCH, Instant.EPOCH.plusSeconds(Int.MAX_VALUE.toLong() + 1), 1.0) }
    }
    @Test fun nonfiniteConstantsFail() {
        for (v in listOf(Double.NaN, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { HarmonicConstituent("M2", v, 0.0) }
            assertFailsWith<IllegalArgumentException> { HarmonicConstituent("M2", 1.0, v) }
            assertFailsWith<IllegalArgumentException> { Station(emptyList(), v) }
        }
    }
    @Test fun reversedAndEqualWindows() {
        val s = Station(emptyList(), 1.0)
        assertTrue(s.heights(t.plusNanos(1), t).isEmpty())
        assertTrue(s.rates(t.plusSeconds(1), t).isEmpty())
        assertEquals(1, s.heights(t, t).size)
        assertEquals(2, s.heights(t.plusSeconds(1), t.plusSeconds(1)).size)
    }
}

// A separate process lets the regression terminate an unbounded root scan safely.
internal object RangeProbe {
    @JvmStatic fun main(args: Array<String>) {
        val constants = listOf(HarmonicConstituent("M12", 1.0, 0.0))
        try {
            if (args.single() == "tide") Station(constants).extremes(Instant.EPOCH, Instant.ofEpochSecond(9_000_000_000_000_000L))
            else CurrentStation(constants).events(Instant.EPOCH, Instant.ofEpochSecond((Int.MAX_VALUE.toLong() / 32 + 1) * 86400))
        } catch (_: IllegalArgumentException) { return }
        error("Oversized event search did not fail")
    }
}
