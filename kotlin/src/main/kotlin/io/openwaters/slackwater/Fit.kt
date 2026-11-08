package io.openwaters.slackwater

import java.time.Duration
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** An offset and harmonic constants fitted to samples, in the samples' units. */
data class HarmonicFit(
    val constituents: List<HarmonicConstituent>,
    val offset: Double,
    val rms: Double,
    /** Rayleigh warnings, largest [UnseparablePair.requiredDays] first. They are diagnostic: noise-free predictions can resolve these pairs. */
    val unseparable: List<UnseparablePair>,
) {
    /** Two constituents whose synodic period, [requiredDays] when rounded up to whole days, is longer than the samples span. */
    data class UnseparablePair(val constituents: List<String>, val requiredDays: Double)
}

/** Why [fit] could not fit the samples. */
sealed class HarmonicFitException(message: String) : IllegalArgumentException(message) {
    /** Too few samples for the basis, a non-finite value, times out of order, or no time between the first and last. */
    class InvalidSamples : HarmonicFitException("invalidSamples")
    class UnknownConstituent(val name: String) : HarmonicFitException("unknownConstituent: $name")
    /** [name] is another name in the basis or one of its aliases. */
    class DuplicateConstituent(val name: String) : HarmonicFitException("duplicateConstituent: $name")
    /** The samples cannot tell the basis's terms apart. */
    class RankDeficient : HarmonicFitException("rankDeficient")
}

/**
 * Fit an offset and a fixed harmonic basis to finite samples ordered by time.
 * Values may be heights or signed velocities; fitted amplitudes keep those units.
 * Equilibrium arguments and nodal corrections are evaluated at every sample time.
 * No trend or automatic constituent selection is applied.
 */
fun fit(samples: List<HarmonicSample>, constituents: List<String>): HarmonicFit {
    val width = 1 + 2 * constituents.size
    val count = samples.size
    if (count < max(2, width) || samples.any { !it.value.isFinite() } ||
        samples.zipWithNext().any { (a, b) -> b.time < a.time } || samples[count - 1].time <= samples[0].time
    ) throw HarmonicFitException.InvalidSamples()
    val seen = HashSet<String>()
    val speeds = constituents.map { name ->
        val speed = Catalog.speed(name) ?: throw HarmonicFitException.UnknownConstituent(name)
        if (!seen.add(Catalog.canonical(name))) throw HarmonicFitException.DuplicateConstituent(name)
        speed
    }
    val spanHours = Duration.between(samples[0].time, samples[count - 1].time).toNanos() / 3.6e12
    val unseparable = ArrayList<HarmonicFit.UnseparablePair>()
    for (i in constituents.indices) for (j in i + 1 until constituents.size) {
        val hours = 360 / abs(speeds[i] - speeds[j])
        if (hours > spanHours) unseparable += HarmonicFit.UnseparablePair(listOf(constituents[i], constituents[j]), ceil(hours / 24))
    }
    unseparable.sortByDescending { it.requiredDays }

    val solver = LeastSquares(width)
    val row = DoubleArray(width)
    row[0] = 1.0
    for (sample in samples) {
        val state = astro(sample.time)
        for ((j, name) in constituents.withIndex()) {
            val correction = Catalog.correction(name, state)
            val theta = (Catalog.v0(name, state) + correction.uDegrees) * D2R
            row[1 + 2 * j] = correction.f * cos(theta)
            row[2 + 2 * j] = correction.f * sin(theta)
        }
        solver.add(row, sample.value)
    }
    val solution = solver.solve()
    return HarmonicFit(
        constituents.mapIndexed { j, name ->
            val a = solution[1 + 2 * j]
            val b = solution[2 + 2 * j]
            HarmonicConstituent(name, hypot(a, b), (atan2(b, a) * R2D + 360) % 360)
        },
        solution[0], solver.rms(), unseparable,
    )
}

/**
 * Least squares by Householder QR of `[R; next batch]`, reduced every batch so a
 * multi-year record needs O(width²) memory. Adapted from packages/engine/src/fit.ts.
 */
private class LeastSquares(private val width: Int) {
    private val capacity = width + max(512, width)
    private val a = Array(capacity) { DoubleArray(width) }
    private val b = DoubleArray(capacity)
    private val v = DoubleArray(capacity)
    // Rows below `width` hold R and Qᵀb; they start as zero rows, which add nothing.
    private var rows = width
    private var count = 0
    private var residualSquares = 0.0

    fun add(row: DoubleArray, value: Double) {
        row.copyInto(a[rows])
        b[rows++] = value
        count++
        if (rows == capacity) reduce()
    }

    private fun reduce() {
        for (k in 0 until width) {
            var norm = 0.0
            for (i in k until rows) norm += a[i][k] * a[i][k]
            // A column already zero from row k down needs no reflection.
            if (norm == 0.0) continue
            norm = sqrt(norm)
            val alpha = if (a[k][k] > 0) -norm else norm
            var vv = 0.0
            for (i in k until rows) {
                v[i] = if (i == k) a[i][k] - alpha else a[i][k]
                vv += v[i] * v[i]
            }
            for (j in k + 1 until width) {
                val scale = 2 * dot(k) { a[it][j] } / vv
                for (i in k until rows) a[i][j] -= scale * v[i]
            }
            val scale = 2 * dot(k) { b[it] } / vv
            for (i in k until rows) b[i] -= scale * v[i]
            a[k][k] = alpha
            for (i in k + 1 until rows) a[i][k] = 0.0
        }
        // Rows past R are zero in every column, so their Qᵀb entries are residual no later batch can reduce.
        for (i in width until rows) residualSquares += b[i] * b[i]
        rows = width
    }

    private inline fun dot(k: Int, column: (Int) -> Double): Double {
        var sum = 0.0
        for (i in k until rows) sum += v[i] * column(i)
        return sum
    }

    fun solve(): DoubleArray {
        if (rows > width) reduce()
        val diagonal = DoubleArray(width) { abs(a[it][it]) }
        // Reject numerical rank loss, not only exact zero pivots, as SlackwaterKit and @slackwater/engine do.
        val threshold = Math.ulp(1.0) * count * diagonal.max()
        if (diagonal.any { !(it > threshold) }) throw HarmonicFitException.RankDeficient()
        val x = DoubleArray(width)
        for (i in width - 1 downTo 0) {
            var sum = b[i]
            for (j in i + 1 until width) sum -= a[i][j] * x[j]
            x[i] = sum / a[i][i]
        }
        if (!x.all { it.isFinite() }) throw HarmonicFitException.RankDeficient()
        return x
    }

    fun rms() = sqrt(residualSquares / count)
}
