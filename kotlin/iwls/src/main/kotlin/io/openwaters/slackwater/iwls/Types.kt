package io.openwaters.slackwater.iwls

import java.time.Duration
import java.time.Instant

internal const val WEEK_SECONDS = 604_800L

/** One IWLS sample: epoch milliseconds and the provider's value, unconverted. */
data class ChsSample(val tMillis: Long, val value: Double)

/** A request window; IWLS treats both ends as inclusive. */
data class ChsChunk(val start: Instant, val end: Instant) {
    /** A full week on the epoch grid, so its identity is the same on every day it is planned. */
    val isCacheable: Boolean
        get() = start.nano == 0 && Math.floorMod(start.epochSecond, WEEK_SECONDS) == 0L &&
            end == start.plusSeconds(WEEK_SECONDS)

    /** Only a whole, bounded week can be kept permanently; interior gaps are allowed. */
    fun canCache(samples: List<ChsSample>, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes): Boolean =
        isCacheable && samples.isNotEmpty() &&
            samples.any { it.tMillis == start.toEpochMilli() } && samples.any { it.tMillis == end.toEpochMilli() } &&
            samples.all { it.value.isFinite() && it.tMillis % grid.millis == 0L &&
                it.tMillis >= start.toEpochMilli() && it.tMillis <= end.toEpochMilli() }
}

/** Provider resolutions supported by fit-series requests. */
data class IwlsSampleGrid(val sampleMinutes: Int) {
    val resolution: String = when (sampleMinutes) {
        1 -> "ONE_MINUTE"
        3 -> "THREE_MINUTES"
        5 -> "FIVE_MINUTES"
        15 -> "FIFTEEN_MINUTES"
        60 -> "SIXTY_MINUTES"
        else -> throw IwlsException.Permanent("unsupported IWLS sample interval: $sampleMinutes")
    }
    internal val millis: Long get() = sampleMinutes * 60_000L

    companion object {
        val fifteenMinutes = IwlsSampleGrid(15)
    }
}

/** A persisted chunk with enough identity and receipt time to validate reuse. */
data class IwlsChunkCacheEntry(
    val startMs: Long,
    val endMs: Long,
    val sampleMinutes: Int,
    val fetchedAtMs: Long,
    val samples: List<ChsSample>,
) {
    fun isReusable(chunk: ChsChunk, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes, now: Instant): Boolean {
        if (startMs != chunk.start.toEpochMilli() || endMs != chunk.end.toEpochMilli() || sampleMinutes != grid.sampleMinutes || !chunk.isCacheable) return false
        if (samples.isNotEmpty()) return chunk.canCache(samples, grid)
        val age = Duration.between(Instant.ofEpochMilli(fetchedAtMs), now)
        return !age.isNegative && age < Duration.ofSeconds(emptyLifetimeSeconds)
    }

    companion object {
        const val emptyLifetimeSeconds = 86_400L

        fun create(chunk: ChsChunk, samples: List<ChsSample>, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes, fetchedAt: Instant): IwlsChunkCacheEntry? {
            if (!chunk.isCacheable || (samples.isNotEmpty() && !chunk.canCache(samples, grid))) return null
            return IwlsChunkCacheEntry(chunk.start.toEpochMilli(), chunk.end.toEpochMilli(), grid.sampleMinutes, fetchedAt.toEpochMilli(), samples)
        }
    }
}

data class IwlsStation(
    val id: String,
    val officialName: String,
    val latitude: Double,
    val longitude: Double,
    val timeSeries: List<String>,
)

data class IwlsMetadata(val floodDirection: Double?, val ebbDirection: Double?)

/** Every failure the client reports, apart from cancellation; `cause` keeps the transport's or decoder's own error. */
sealed class IwlsException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** Another attempt would get the same answer. */
    class Permanent(message: String, cause: Throwable? = null) : IwlsException(message, cause)

    /** The request might succeed later; the application's queue decides when. */
    class Transient(message: String, cause: Throwable? = null) : IwlsException(message, cause)
}
