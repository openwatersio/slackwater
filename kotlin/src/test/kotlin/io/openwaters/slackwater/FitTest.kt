package io.openwaters.slackwater

import java.io.File
import java.time.Instant
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sqrt
import kotlin.test.*
import kotlinx.serialization.json.*

class FitTest {
    private val input = fixture("harmonic-fit")
    private val basis = input.array("basis").map { it.jsonPrimitive.content }
    private fun JsonElement.samples() = jsonArray.map {
        val s = it.obj()
        HarmonicSample(Instant.ofEpochMilli(s.number("t").toLong()), s.number("v"))
    }
    private val firstCase = input.array("cases")[0].obj().getValue("samples").samples()

    @Test fun matchesTheSharedSvdOracle() {
        val parity = fixture("harmonic-fit-parity").array("cases").map { it.obj() }
        for (entry in input.array("cases").map { it.obj() }) {
            val days = entry.number("days")
            val result = fit(entry.getValue("samples").samples(), basis)
            val expected = parity.single { it.number("days") == days }.getValue("expected").obj()
            assertEquals(expected.number("offset"), result.offset, 1e-7, "offset, $days days")
            assertEquals(expected.number("rms"), result.rms, 1e-7, "rms, $days days")
            val constituents = expected.constituents()
            assertEquals(constituents.map { it.name }, result.constituents.map { it.name })
            for ((actual, want) in result.constituents.zip(constituents)) {
                assertEquals(want.amplitude, actual.amplitude, 1e-6, "${want.name} amplitude, $days days")
                assertTrue(angularDiff(actual.phaseDegrees, want.phaseDegrees) < 1e-3, "${want.name} phase, $days days")
            }
            val pairs = entry.getValue("expected").obj().array("unseparable").map {
                val p = it.obj()
                HarmonicFit.UnseparablePair(p.array("constituents").map { n -> n.jsonPrimitive.content }, p.number("requiredDays"))
            }
            assertEquals(pairs, result.unseparable)
        }
    }

    @Test fun recoversUnroundedCoefficientsWithGapsAndRepeatedTimestamps() {
        val truth = listOf(HarmonicConstituent("M2", 1.23456789, 359.999), HarmonicConstituent("O1", 0.3456789, 0.001))
        val samples = (0 until 800).map { i ->
            val time = Instant.ofEpochSecond(1_262_304_000L + (i / 2) * 37L * 3600)
            val state = astro(time)
            HarmonicSample(time, truth.fold(-2.3456789) { sum, c ->
                val correction = Catalog.shared.correction(c.name, state)
                sum + c.amplitude * correction.f * cos((Catalog.shared.v0(c.name, state) + correction.uDegrees - c.phaseDegrees) * PI / 180)
            })
        }
        val result = fit(samples, truth.map { it.name })
        assertEquals(-2.3456789, result.offset, 1e-10)
        assertTrue(result.rms < 1e-10, "rms ${result.rms}")
        assertEquals(emptyList(), result.unseparable)
        for ((actual, want) in result.constituents.zip(truth)) {
            assertEquals(want.amplitude, actual.amplitude, 1e-10)
            assertTrue(angularDiff(actual.phaseDegrees, want.phaseDegrees) < 1e-8, "${want.name} phase ${actual.phaseDegrees}")
        }
    }

    @Test fun fitsAnOffsetWithoutHarmonics() {
        val result = fit(listOf(HarmonicSample(Instant.EPOCH, 1.0), HarmonicSample(Instant.ofEpochSecond(1), 3.0)), emptyList())
        assertEquals(2.0, result.offset, 1e-12)
        assertEquals(1.0, result.rms, 1e-12)
        assertEquals(emptyList(), result.constituents)
    }

    @Test fun preservesResidualsAcrossBatchesWithInitiallySingularTimestamps() {
        val samples = (0 until 1200).map { i ->
            HarmonicSample(Instant.ofEpochSecond(if (i < 600) 0L else i * 3600L), if (i % 2 == 1) 1.0 else 3.0)
        }
        val result = fit(samples, emptyList())
        assertEquals(2.0, result.offset, 1e-12)
        assertEquals(1.0, result.rms, 1e-12)
        val m2 = fit(samples, listOf("M2"))
        assertEquals(residualRms(samples, m2), m2.rms, 1e-12)
        assertTrue(m2.rms <= result.rms)
    }

    @Test fun measuresSpansLongerThanNanosecondsHold() {
        val samples = listOf(HarmonicSample(Instant.parse("1700-01-01T00:00:00Z"), 1.0), HarmonicSample(Instant.parse("2026-01-01T00:00:00Z"), 3.0))
        assertEquals(2.0, fit(samples, emptyList()).offset, 1e-12)
    }

    private fun residualRms(samples: List<HarmonicSample>, result: HarmonicFit) = sqrt(samples.sumOf { s ->
        val state = astro(s.time)
        val model = result.constituents.fold(result.offset) { sum, c ->
            val correction = Catalog.shared.correction(c.name, state)
            sum + c.amplitude * correction.f * cos((Catalog.shared.v0(c.name, state) + correction.uDegrees - c.phaseDegrees) * PI / 180)
        }
        (model - s.value) * (model - s.value)
    } / samples.size)

    @Test fun preservesRepeatedSamplesAcrossBatchBoundaries() {
        val original = fit(firstCase, basis)
        val repeated = fit(firstCase.flatMap { listOf(it, it) }, basis)
        assertEquals(original.offset, repeated.offset, 1e-10)
        assertEquals(original.rms, repeated.rms, 1e-10)
        for ((a, b) in original.constituents.zip(repeated.constituents)) {
            assertEquals(a.amplitude, b.amplitude, 1e-9)
            assertTrue(angularDiff(a.phaseDegrees, b.phaseDegrees) < 1e-6)
        }
    }

    @Test fun theSharedOracleFitsTheChsTideRecipe() {
        assertEquals(ChsTideFit.basis, basis)
    }

    @Test fun fitsValuesNearTheLargestFiniteNumber() {
        val samples = listOf(HarmonicSample(Instant.EPOCH, 5e307), HarmonicSample(Instant.ofEpochSecond(1), 5e307))
        assertEquals(1.0, fit(samples, emptyList()).offset / 5e307, 1e-12)
        val spread = listOf(HarmonicSample(Instant.EPOCH, 4e307), HarmonicSample(Instant.ofEpochSecond(1), 6e307))
        assertEquals(1.0, fit(spread, emptyList()).rms / 1e307, 1e-12)
    }

    @Test fun rejectsOverflowInTheSolution() {
        assertFailsWith<HarmonicFitException.RankDeficient> {
            fit(firstCase.map { it.copy(value = Double.MAX_VALUE) }, emptyList())
        }
    }

    @Test fun rejectsNonFiniteValues() {
        for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertFailsWith<HarmonicFitException.InvalidSamples> {
                fit(listOf(firstCase[0].copy(value = value)) + firstCase.drop(1), emptyList())
            }
        }
    }

    @Test fun rejectsTheSharedInvalidInputs() {
        val invalid = Json.parseToJsonElement(File(System.getProperty("fixtures"), "harmonic-fit-invalid.json").readText())
        for (entry in invalid.jsonArray.map { it.obj() }) {
            val names = entry.array("names").map { it.jsonPrimitive.content }
            val error = assertFailsWith<HarmonicFitException> { fit(entry.getValue("samples").samples(), names) }
            when (entry.string("error")) {
                "invalidSamples" -> assertIs<HarmonicFitException.InvalidSamples>(error)
                "unknownConstituent" -> assertEquals(names[0], assertIs<HarmonicFitException.UnknownConstituent>(error).name)
                "duplicateConstituent" -> assertEquals(names[1], assertIs<HarmonicFitException.DuplicateConstituent>(error).name)
                "rankDeficient" -> assertIs<HarmonicFitException.RankDeficient>(error)
                else -> fail("Unknown fixture error ${entry.string("error")}")
            }
        }
    }
}
