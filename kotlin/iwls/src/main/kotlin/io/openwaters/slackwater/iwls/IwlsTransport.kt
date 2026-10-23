package io.openwaters.slackwater.iwls

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withTimeoutOrNull

/** One HTTP attempt's result. `body` is the decoded text for a 200, and null otherwise. */
data class IwlsResponse(
    val status: Int,
    val body: String?,
    val retryAfter: String?,
    /** Without HTTP framing, an unreadable JSON body may have been cut short by a lost connection. */
    val closeDelimited: Boolean = false,
)

/** One GET per call, with no retries; an application can supply OkHttp or another stack. */
fun interface IwlsTransport {
    suspend fun get(url: URL): IwlsResponse
}

/**
 * The default transport, on the JVM's and Android's built-in HttpURLConnection. Each attempt is
 * bounded at `timeoutMillis`, as Swift's resource timeout bounds it, and cancelling the caller
 * ends the wait at once.
 *
 * HttpURLConnection blocks, and disconnect can wait on the reader's lock. Attempts and disconnects
 * use separate bounded pools: eight request workers with no queue and two cleanup workers with
 * at most eight pending disconnects. Cleanup can release a saturated request pool even while
 * response headers trickle in and prevent the 15-second idle timeout.
 */
class HttpUrlConnectionTransport(private val timeoutMillis: Long = 300_000) : IwlsTransport {
    init {
        // HttpURLConnection reads 0 as no timeout and takes the value as an Int.
        require(timeoutMillis in 1..Int.MAX_VALUE) { "timeoutMillis must be between 1 and ${Int.MAX_VALUE}" }
    }

    override suspend fun get(url: URL): IwlsResponse {
        val abandoned = AtomicBoolean(false)
        // Its own flag: awaiting a future cancels it on cancellation, and a cancelled future counts as done.
        val running = AtomicBoolean(true)
        val connection = url.openConnection() as HttpURLConnection
        val attempt = try {
            CompletableFuture.supplyAsync({ fetch(connection, abandoned, running) }, threads)
        } catch (error: RejectedExecutionException) {
            throw IOException("IWLS transport is busy", error)
        }
        try {
            // Only this attempt's own bound becomes a timeout; a caller's timeout stays its cancellation.
            return withTimeoutOrNull(timeoutMillis) { attempt.await() }
                ?: throw SocketTimeoutException("IWLS request timed out after $timeoutMillis ms")
        } finally {
            if (running.get()) {
                abandoned.set(true)
                try {
                    cleanupThreads.execute { connection.disconnect() }
                } catch (_: RejectedExecutionException) {
                    // If cleanup also saturates, body reads observe abandonment; header reads rely on network idle.
                }
            }
        }
    }

    private fun fetch(connection: HttpURLConnection, abandoned: AtomicBoolean, running: AtomicBoolean): IwlsResponse {
        try {
            connection.connectTimeout = minOf(timeoutMillis, 15_000).toInt()
            connection.readTimeout = minOf(timeoutMillis, 15_000).toInt()
            // Android's transparent gzip removes framing headers needed to classify truncated bodies.
            connection.setRequestProperty("Accept-Encoding", "identity")
            val status = connection.responseCode
            // -1 is HttpURLConnection's answer to a reply that is not HTTP: an invalid server response.
            if (status < 0) throw ProtocolException("IWLS sent a response that is not HTTP")
            val retryAfter = connection.getHeaderField("Retry-After")
            val length = connection.contentLengthLong
            if (status == 200 && length > MAX_BODY_BYTES) throw IwlsException.Permanent("IWLS response exceeds $MAX_BODY_BYTES bytes")
            val bytes = if (status == 200) readBody(connection.inputStream, abandoned) else null
            // The JDK ends a body cut short of its Content-Length as if it were complete; it is a lost link.
            if (bytes != null && length >= 0 && bytes.size.toLong() != length) {
                throw EOFException("IWLS response ended after ${bytes.size} of $length bytes")
            }
            val body = bytes?.toString(Charsets.UTF_8)
            val closeDelimited = status == 200 && length < 0 &&
                !connection.getHeaderField("Transfer-Encoding").orEmpty().split(',').any { it.trim().equals("chunked", ignoreCase = true) }
            return IwlsResponse(status, body, retryAfter, closeDelimited)
        } finally {
            running.set(false)
            connection.disconnect()
        }
    }

    // Read in pieces so an abandoned attempt stops at its next read instead of draining the response.
    internal fun readBody(stream: InputStream, abandoned: AtomicBoolean): ByteArray {
        val body = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            if (abandoned.get()) throw InterruptedIOException("IWLS attempt abandoned")
            val count = stream.read(buffer)
            if (count < 0) return body.toByteArray()
            if (count > MAX_BODY_BYTES - body.size()) throw IwlsException.Permanent("IWLS response exceeds $MAX_BODY_BYTES bytes")
            body.write(buffer, 0, count)
        }
    }

    private companion object {
        const val MAX_BODY_BYTES = 8 * 1024 * 1024
        val cleanupThreads = ThreadPoolExecutor(2, 2, 60, TimeUnit.SECONDS, ArrayBlockingQueue(8)) { task ->
            Thread(task, "iwls-disconnect").apply { isDaemon = true }
        }.apply { allowCoreThreadTimeOut(true) }
        val threads = ThreadPoolExecutor(0, 8, 60, TimeUnit.SECONDS, SynchronousQueue()) { task ->
            Thread(task, "iwls-http").apply { isDaemon = true }
        }
    }
}
