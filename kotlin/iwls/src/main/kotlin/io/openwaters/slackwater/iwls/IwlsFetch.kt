package io.openwaters.slackwater.iwls

import java.io.EOFException
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale
import javax.net.ssl.SSLException
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.serialization.json.*

/** The rules of docs/iwls-fetch.md that need no network. */
object IwlsFetch {
    const val BASE = "https://api-iwls.dfo-mpo.gc.ca/api/v1"

    /** The start of `now`'s calendar day in `zone`: the first midnight of a repeated one, or the first instant of a day that skips it. */
    fun localMidnight(now: Instant, zone: ZoneId): Instant =
        now.atZone(zone).toLocalDate().atStartOfDay(zone).toInstant()

    /** Newest first, on the absolute 7-day epoch grid, spanning at least `days` and less than `days + 7`. */
    fun chunkPlan(days: Double, end: Instant): List<ChsChunk> {
        require(days.isFinite() && days > 0) { "chunkPlan needs a positive, finite duration" }
        val endSeconds = end.epochSecond + end.nano / 1e9
        val chunks = mutableListOf<ChsChunk>()
        // Only the grid-aligned start is computed in Double; every comparison is on exact instants,
        // since a Double near 1.8e9 seconds cannot tell an end 100 ns past a boundary from the boundary.
        var t = Instant.ofEpochSecond(floor((endSeconds - days * 86_400) / WEEK_SECONDS).toLong() * WEEK_SECONDS)
        while (t < end) {
            val next = t.plusSeconds(WEEK_SECONDS)
            chunks += ChsChunk(t, if (next < end) next else end)
            t = next
        }
        return chunks.reversed()
    }

    const val RESOLVE_TOLERANCE_KM = 3.0

    /** The nearest station serving `series`, by position; names and codes are display metadata. */
    fun resolve(name: String, latitude: Double, longitude: Double, series: String, stations: List<IwlsStation>): IwlsStation {
        var best: IwlsStation? = null
        var bestKm = Double.POSITIVE_INFINITY
        for (station in stations) {
            if (series !in station.timeSeries) continue
            val km = distanceKm(latitude, longitude, station.latitude, station.longitude)
            // Strictly nearer, so ties keep list order.
            if (km < bestKm) {
                best = station
                bestKm = km
            }
        }
        val found = best ?: throw IwlsException.Permanent("no IWLS station serves $series")
        if (bestKm > RESOLVE_TOLERANCE_KM) {
            throw IwlsException.Permanent(
                "$name: nearest $series station ${found.officialName} is ${String.format(Locale.ROOT, "%.1f", bestKm)} km away"
            )
        }
        return found
    }

    fun decodeStations(json: String): List<IwlsStation> = Json.parseToJsonElement(json).jsonArray.map { element ->
        val station = element.jsonObject
        IwlsStation(
            station.requireString("id"),
            station.requireString("officialName"),
            station.requireNumber("latitude"),
            station.requireNumber("longitude"),
            (station["timeSeries"] as? JsonArray ?: throw IllegalArgumentException("IWLS timeSeries must be an array"))
                .map { it.jsonObject.requireString("code") },
        )
    }

    // Whole seconds with a UTC designator or numeric offset, with or without its colon, as Swift's
    // ISO8601DateFormatter reads them. Fractional seconds are skipped, as the contract says.
    private val EVENT_DATE = Regex("""\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})""")

    internal fun parseEventDate(value: String): Long? {
        if (!EVENT_DATE.matches(value)) return null
        val withColon = if (value.endsWith("Z") || value[value.length - 3] == ':') value
            else value.dropLast(2) + ":" + value.takeLast(2)
        return try {
            OffsetDateTime.parse(withColon).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            null
        }
    }

    /** Samples in response order, dropping a timestamp only when it repeats the one just kept. */
    fun decode(json: String): List<ChsSample> {
        val samples = ArrayList<ChsSample>()
        for (element in Json.parseToJsonElement(json).jsonArray) {
            val row = element.jsonObject
            // Both fields are required even on a row whose date is skipped, as Swift's Codable decode requires them.
            val value = row.requireNumber("value")
            val t = parseEventDate(row.requireString("eventDate")) ?: continue
            if (samples.lastOrNull()?.tMillis != t) samples += ChsSample(t, value)
        }
        return samples
    }

    fun onGrid(samples: List<ChsSample>, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes): List<ChsSample> =
        samples.filter { it.tMillis % grid.millis == 0L }

    fun decodeMetadata(json: String): IwlsMetadata {
        val metadata = Json.parseToJsonElement(json).jsonObject
        return IwlsMetadata(metadata.optionalNumber("floodDirection"), metadata.optionalNumber("ebbDirection"))
    }

    /** The series a fit reads; the grid filter would empty event series such as wlp-hilo. */
    val FIT_SERIES: Set<String> = setOf("wlp", "wcsp1", "wcdp1")

    val stationsUrl: URL get() = URL("$BASE/stations")

    fun dataUrl(code: String, stationId: String, chunk: ChsChunk, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes): URL {
        if (stationId.isEmpty() || code !in FIT_SERIES || chunk.end < chunk.start ||
            Duration.between(chunk.start, chunk.end) > Duration.ofSeconds(WEEK_SECONDS)
        ) {
            throw IwlsException.Permanent("invalid IWLS series request")
        }
        val query = listOf(
            "time-series-code" to code,
            "from" to wholeSeconds(chunk.start),
            "to" to wholeSeconds(chunk.end),
            "resolution" to grid.resolution,
        ).joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8")}" }
        return URL("$BASE/stations/${pathComponent(stationId)}/data?$query")
    }

    fun metadataUrl(stationId: String): URL {
        if (stationId.isEmpty()) throw IwlsException.Permanent("invalid IWLS station id")
        return URL("$BASE/stations/${pathComponent(stationId)}/metadata")
    }

    private fun wholeSeconds(instant: Instant): String = instant.truncatedTo(ChronoUnit.SECONDS).toString()

    // One path component: RFC 3986's path characters kept, less `/`, the same set Swift spells
    // out in `pathKept`. Everything else, including `%`, `?` and `#`, is percent-encoded.
    private const val PATH_KEPT = "-._~!\$&'()*+,;=:@"

    private fun pathComponent(id: String): String = buildString {
        // "." and ".." are dot segments: URL resolution removes them, escaped or not.
        if (id == "." || id == "..") throw IwlsException.Permanent("invalid IWLS station id")
        for (byte in id.toByteArray(Charsets.UTF_8)) {
            val code = byte.toInt() and 0xff
            val char = code.toChar()
            if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char in PATH_KEPT) append(char)
            else append(String.format(Locale.ROOT, "%%%02X", code))
        }
    }

    const val MAX_ATTEMPTS = 4

    /** The longest `Retry-After` the client waits, so one header cannot hold a queue for hours. */
    const val MAX_RETRY_AFTER_SECONDS = 600.0

    sealed interface Outcome {
        data class Status(val code: Int) : Outcome
        data class Failure(val error: Throwable) : Outcome
    }

    /** Seconds before another attempt, or null when the client should stop; `attempt` counts the one that just failed. */
    fun retryDelaySeconds(outcome: Outcome, attempt: Int, retryAfter: Double? = null): Double? {
        if (attempt >= MAX_ATTEMPTS) return null
        val backoff = 2.0.pow(attempt)
        val asked = retryAfter?.takeIf { it.isFinite() && it >= 0 }?.coerceAtMost(MAX_RETRY_AFTER_SECONDS) ?: 0.0
        return when (outcome) {
            is Outcome.Failure -> if (isTransient(outcome.error)) backoff else null
            is Outcome.Status -> when {
                outcome.code == 429 -> max(asked, 60.0)
                outcome.code in 500..599 && outcome.code !in setOf(501, 505, 511) -> max(asked, backoff)
                else -> null
            }
        }
    }

    fun terminalError(status: Int): IwlsException =
        if (status in 400..499 && status != 429) IwlsException.Permanent("HTTP $status")
        else IwlsException.Transient("HTTP $status")

    /**
     * Any I/O failure anywhere in the cause chain: timeouts, unreachable or unknown hosts, lost
     * links, invalid responses. Never a failed TLS handshake, certificate or protocol, and never
     * cancellation or a programming error.
     */
    fun isTransient(error: Throwable): Boolean {
        val chain = generateSequence(error) { it.cause }.take(16).toList()
        // A TLS failure (handshake, certificate, protocol, a server that does not speak this TLS)
        // gets the same answer next time, however it is wrapped, unless the link itself dropped
        // under it: stacks report a reset during TLS as a TLS failure too.
        if (chain.any { it is SSLException } && chain.none { it.isLinkFailure() }) return false
        // Stacks report lost links as plain IOExceptions: the JDK's "Premature EOF", Android's
        // "unexpected end of stream", Conscrypt's bare SSLException for a reset. A queue told one
        // was permanent would drop a chunk the next attempt would fetch.
        return chain.any { it is IOException }
    }

    // Conscrypt reports a reset under TLS with no cause, only this text in the message.
    private fun Throwable.isLinkFailure(): Boolean =
        this is SocketException || this is EOFException || this is SocketTimeoutException ||
            message.orEmpty().let { "Connection reset" in it || "I/O error during system call" in it }

    // Decimal seconds only: no surrounding spaces, no hex or binary literal, no HTTP date.
    private val RETRY_AFTER = Regex("""[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?""")

    fun parseRetryAfter(header: String?): Double? = header?.takeIf { RETRY_AFTER.matches(it) }?.toDouble()

    private fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = p2 - p1
        val dl = Math.toRadians(lon2 - lon1)
        val h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * 6371.0088 * asin(min(1.0, sqrt(h)))
    }
}
