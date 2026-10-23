package io.openwaters.slackwater.iwls

import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import kotlin.test.*
import kotlinx.coroutines.*

class TransportTest {
    private val trickleEnded = java.util.concurrent.CompletableFuture<Long>()

    private val server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
        // Daemon threads, so a handler still sleeping in /stall cannot hold the test JVM open.
        executor = Executors.newCachedThreadPool { task -> Thread(task).apply { isDaemon = true } }
        createContext("/ok") { it.sendResponseHeaders(200, 2); it.responseBody.use { body -> body.write("[]".toByteArray()) } }
        createContext("/limited") {
            it.responseHeaders.add("Retry-After", "30")
            it.sendResponseHeaders(429, 9)
            it.responseBody.use { body -> body.write("slow down".toByteArray()) }
        }
        createContext("/down") { it.sendResponseHeaders(503, -1); it.close() }
        createContext("/stall") {
            try { Thread.sleep(10_000); it.sendResponseHeaders(200, -1) } catch (e: Exception) { } finally { it.close() }
        }
        createContext("/stallbody") {
            try {
                // Headers late in the attempt, then nothing: idle timeouts alone would run past the bound.
                Thread.sleep(800)
                it.sendResponseHeaders(200, 0)
                it.responseBody.write('['.code)
                it.responseBody.flush()
                Thread.sleep(10_000)
            } catch (e: Exception) { } finally { it.close() }
        }
        createContext("/trickle") {
            try {
                it.sendResponseHeaders(200, 0)
                repeat(200) { _ -> it.responseBody.write('['.code); it.responseBody.flush(); Thread.sleep(50) }
            } catch (e: IOException) { } finally { trickleEnded.complete(System.nanoTime()); it.close() }
        }
        start()
    }

    private fun url(path: String) = URL("http://127.0.0.1:${server.address.port}$path")

    @AfterTest fun stop() = server.stop(0)

    @Test fun readsTheBodyOfASuccess() = runBlocking {
        assertEquals(IwlsResponse(200, "[]", null), HttpUrlConnectionTransport().get(url("/ok")))
    }

    @Test fun reportsStatusAndRetryAfterWithoutTheErrorBody() = runBlocking {
        assertEquals(IwlsResponse(429, null, "30"), HttpUrlConnectionTransport().get(url("/limited")))
        assertEquals(IwlsResponse(503, null, null), HttpUrlConnectionTransport().get(url("/down")))
    }

    @Test fun timesOutAStalledResponse() = runBlocking {
        assertFailsWith<SocketTimeoutException> { HttpUrlConnectionTransport(300).get(url("/stall")) }
        Unit
    }

    @Test fun boundsTheWholeAttemptNotJustIdleTime() = runBlocking {
        // A byte every 50 ms never trips a 400 ms read timeout; the attempt bound still ends it.
        val began = System.nanoTime()
        assertFailsWith<SocketTimeoutException> { HttpUrlConnectionTransport(400).get(url("/trickle")) }
        val elapsedMillis = (System.nanoTime() - began) / 1_000_000
        assertTrue(elapsedMillis < 5_000, "took $elapsedMillis ms")
    }

    private suspend fun elapsedMillis(block: suspend () -> Unit): Long {
        val began = System.nanoTime()
        block()
        return (System.nanoTime() - began) / 1_000_000
    }

    @Test fun aBodyThatStallsEndsAtTheAttemptBound() = runBlocking {
        val took = elapsedMillis {
            assertFailsWith<SocketTimeoutException> { HttpUrlConnectionTransport(1_000).get(url("/stallbody")) }
        }
        assertTrue(took < 1_600, "took $took ms")
    }

    @Test fun cancellationEndsABodyThatStalls() = runBlocking {
        val pending = launch(Dispatchers.Default) { HttpUrlConnectionTransport(60_000).get(url("/stallbody")) }
        delay(1_200)
        val took = elapsedMillis { withTimeout(2_000) { pending.cancelAndJoin() } }
        assertTrue(took < 1_500, "took $took ms")
    }

    @Test fun aCallersOwnTimeoutStaysACancellation() = runBlocking {
        assertFailsWith<TimeoutCancellationException> {
            withTimeout(1_200) { HttpUrlConnectionTransport(60_000).get(url("/stallbody")) }
        }
        Unit
    }

    @Test fun aReplyThatIsNotHttpIsAProtocolFailure() = runBlocking {
        val socket = java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val replier = Thread {
            socket.use { s -> s.accept().use { c -> c.getOutputStream().write("not an HTTP response\r\n\r\n".toByteArray()) } }
        }.apply { isDaemon = true; start() }
        val error = assertFailsWith<java.net.ProtocolException> {
            HttpUrlConnectionTransport(5_000).get(URL("http://127.0.0.1:${socket.localPort}/"))
        }
        replier.join(5_000)
        assertTrue(IwlsFetch.isTransient(error))
    }

    @Test fun requestsDoNotQueueBehindABusyIoDispatcher() = runBlocking {
        // A request admitted by the pacer must start then, not when blocked I/O elsewhere frees a thread.
        val blockers = List(128) { launch(Dispatchers.IO) { Thread.sleep(1_500) } }
        delay(100)
        val took = elapsedMillis { HttpUrlConnectionTransport().get(url("/ok")) }
        assertTrue(took < 1_400, "took $took ms")
        blockers.joinAll()
    }

    @Test fun rejectsATimeoutItCannotHonour() {
        for (timeout in listOf(0L, -1L, Int.MAX_VALUE + 1L)) {
            assertFailsWith<IllegalArgumentException>(timeout.toString()) { HttpUrlConnectionTransport(timeout) }
        }
    }

    @Test fun aBodyCutShortOfItsLengthIsALostConnection() = runBlocking {
        val socket = java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val replier = Thread {
            socket.use { s ->
                s.accept().use { c ->
                    c.getInputStream().read(ByteArray(4096))
                    c.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\n[{\"eventDate\"".toByteArray())
                }
            }
        }.apply { isDaemon = true; start() }
        val error = assertFails { HttpUrlConnectionTransport(5_000).get(URL("http://127.0.0.1:${socket.localPort}/")) }
        replier.join(5_000)
        assertTrue(IwlsFetch.isTransient(error), error.toString())
    }

    @Test fun aCompleteBodyIsMeasuredInBytesNotDecodedText() = runBlocking {
        // A stray byte that is not UTF-8 decodes to a three-byte replacement character; the body is still whole.
        val socket = java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val body = byteArrayOf('['.code.toByte(), 0xFF.toByte(), ']'.code.toByte())
        val replier = Thread {
            socket.use { s ->
                s.accept().use { c ->
                    c.getInputStream().read(ByteArray(4096))
                    c.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\n".toByteArray() + body)
                }
            }
        }.apply { isDaemon = true; start() }
        val response = HttpUrlConnectionTransport(5_000).get(URL("http://127.0.0.1:${socket.localPort}/"))
        replier.join(5_000)
        assertEquals(200, response.status)
        assertEquals("[�]", response.body)
    }

    @Test fun aRefusedConnectionSurfacesAsItsOwnError() = runBlocking {
        val closedPort = java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress()).use { it.localPort }
        val error = assertFailsWith<java.net.ConnectException> {
            HttpUrlConnectionTransport(5_000).get(URL("http://127.0.0.1:$closedPort/"))
        }
        assertTrue(IwlsFetch.isTransient(error))
    }

    @Test fun anAbandonedAttemptReleasesItsConnection() = runBlocking {
        // The caller stops waiting at the bound; the attempt it left behind must not keep reading.
        assertFailsWith<SocketTimeoutException> { HttpUrlConnectionTransport(400).get(url("/trickle")) }
        val gaveUp = System.nanoTime()
        val serverSawItClose = trickleEnded.get(5, java.util.concurrent.TimeUnit.SECONDS)
        val afterMillis = (serverSawItClose - gaveUp) / 1_000_000
        assertTrue(afterMillis < 2_000, "connection held $afterMillis ms after the caller gave up")
    }

    @Test fun anAbandonedReadStopsAtItsNextPiece() {
        val error = assertFailsWith<java.io.InterruptedIOException> {
            HttpUrlConnectionTransport().readBody("[]".byteInputStream(), java.util.concurrent.atomic.AtomicBoolean(true))
        }
        assertEquals("IWLS attempt abandoned", error.message)
        assertEquals("[]", HttpUrlConnectionTransport().readBody("[]".byteInputStream(), java.util.concurrent.atomic.AtomicBoolean(false)).toString(Charsets.UTF_8))
    }

    @Test fun cancellationDisconnectsAnInFlightRequest() = runBlocking {
        val pending = launch(Dispatchers.Default) { HttpUrlConnectionTransport(60_000).get(url("/stall")) }
        delay(300)
        withTimeout(3_000) { pending.cancelAndJoin() }
        assertTrue(pending.isCancelled)
    }
}
