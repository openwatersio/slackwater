package io.openwaters.slackwater.iwls

import io.openwaters.slackwater.iwls.IwlsFetch.Outcome
import java.io.EOFException
import java.net.SocketTimeoutException
import java.net.URL
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.ceil
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.Json

/** Fetches the contract's inputs for fitting on this device. Every call is cancellable. */
class IwlsClient internal constructor(
    private val transport: IwlsTransport,
    internal val pacer: IwlsPacer,
    private val sleep: suspend (Double) -> Unit,
) {
    // Every public client shares the process pacer, as the contract requires; only tests pace separately.
    constructor(transport: IwlsTransport = HttpUrlConnectionTransport()) : this(transport, sharedPacer)

    internal constructor(transport: IwlsTransport, pacer: IwlsPacer) :
        this(transport, pacer, { seconds -> delay(ceil(seconds * 1_000).toLong()) })

    suspend fun stationList(): List<IwlsStation> = decoding(get(IwlsFetch.stationsUrl), IwlsFetch::decodeStations)

    suspend fun metadata(stationId: String): IwlsMetadata =
        decoding(get(IwlsFetch.metadataUrl(stationId)), IwlsFetch::decodeMetadata)

    /** One fit-series chunk on the selected recipe's grid. */
    suspend fun series(code: String, stationId: String, chunk: ChsChunk, grid: IwlsSampleGrid = IwlsSampleGrid.fifteenMinutes): List<ChsSample> =
        IwlsFetch.onGrid(decoding(get(IwlsFetch.dataUrl(code, stationId, chunk, grid)), IwlsFetch::decode), grid)

    // A body IWLS sent but nobody can read would be the same body next time.
    private fun <T> decoding(body: String, decode: (String) -> T): T = try {
        decode(body)
    } catch (e: IllegalArgumentException) {
        throw IwlsException.Permanent("IWLS sent a response that could not be read", e)
    }

    private suspend fun get(url: URL): String {
        var attempt = 0
        while (true) {
            attempt += 1
            pacer.await()
            var failure: Exception? = null
            var response = try {
                transport.get(url)
            } catch (e: Exception) {
                // A failure that arrives because the caller cancelled is the cancellation, not a retry.
                currentCoroutineContext().ensureActive()
                // A cancellation the caller did not ask for is the transport's own timeout.
                failure = if (e is CancellationException) SocketTimeoutException("IWLS transport timed out").apply { initCause(e) } else e
                null
            }
            // Only a 200 supplies a body; decoding errors are not retried, but an empty response is.
            if (response != null && response.status == 200) {
                val body = response.body
                if (!body.isNullOrEmpty()) {
                    if (!response.closeDelimited) return body
                    try {
                        Json.parseToJsonElement(body)
                        return body
                    } catch (error: IllegalArgumentException) {
                        failure = EOFException("IWLS sent a possibly truncated response").apply { initCause(error) }
                    }
                } else failure = EOFException("IWLS sent an empty response")
                response = null
            }
            val outcome = if (response != null) Outcome.Status(response.status) else Outcome.Failure(failure!!)
            val retryAfter = response?.let { IwlsFetch.parseRetryAfter(it.retryAfter) }
            val seconds = IwlsFetch.retryDelaySeconds(outcome, attempt, retryAfter) ?: throw when (outcome) {
                is Outcome.Status -> IwlsFetch.terminalError(outcome.code)
                is Outcome.Failure -> wrap(outcome.error)
            }
            sleep(seconds)
        }
    }

    // IWLS answers (client errors, unreadable bodies) and local response-size limits are permanent. A transport failure
    // the client did not retry, a TLS one among them, can still succeed later: behind a captive
    // portal, after a clock is corrected, or once a stack's own idea of "offline" passes.
    private fun wrap(error: Throwable): IwlsException =
        error as? IwlsException ?: IwlsException.Transient("IWLS request failed: $error", error)

    companion object {
        /** Shared by every public client, so separate callers cannot double the request rate. */
        internal val sharedPacer = IwlsPacer()
    }
}
