package io.openwaters.slackwater.iwls

import java.net.SocketException
import java.net.URL
import java.time.Instant
import javax.net.ssl.SSLHandshakeException
import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*

private class FakeServer(
    vararg replies: Any,
    private val retryAfter: String? = null,
    private val body: String = "[]",
) {
    private val replies = ArrayDeque(replies.toList())
    val urls = mutableListOf<URL>()
    val delays = mutableListOf<Double>()
    val transport = IwlsTransport { url ->
        urls += url
        when (val reply = this.replies.removeFirst()) {
            is Int -> IwlsResponse(reply, if (reply == 200) body else "error", retryAfter)
            is Exception -> throw reply
            else -> error("unexpected reply $reply")
        }
    }

    fun client(pacer: IwlsPacer = IwlsPacer(0)) = IwlsClient(transport, pacer) { delays += it }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ClientTest {
    private val firstChunk = ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(900))

    @Test fun waitsOutRateLimitsAndServerErrorsThenDecodesGridSamples() = runTest {
        val server = FakeServer(429, 503, 200, retryAfter = "90", body = """
            [{"eventDate":"1970-01-01T00:00:00Z","value":2},{"eventDate":"1970-01-01T00:01:00Z","value":3}]""")
        assertEquals(listOf(ChsSample(0, 2.0)), server.client().series("wlp", "resolved", firstChunk))
        assertEquals(listOf(90.0, 90.0), server.delays)
        assertEquals(1, server.urls.toSet().size)
    }

    @Test fun stopsAfterFourAttemptsWithATransientError() = runTest {
        val server = FakeServer(500, 500, 500, 500)
        val error = assertFailsWith<IwlsException.Transient> { server.client().stationList() }
        assertEquals("HTTP 500", error.message)
        assertEquals(4, server.urls.size)
        assertEquals(listOf(2.0, 4.0, 8.0), server.delays)
    }

    @Test fun failsAClientErrorAtOnceAsPermanent() = runTest {
        val server = FakeServer(404)
        assertFailsWith<IwlsException.Permanent> { server.client().stationList() }
        assertEquals(emptyList(), server.delays)
    }

    @Test fun retriesADroppedLinkButNotATlsFailure() = runTest {
        val dropped = FakeServer(SocketException("Connection reset"), 200)
        assertEquals(emptyList(), dropped.client().stationList())
        assertEquals(listOf(2.0), dropped.delays)
        // Not retried here, as the contract says, but not Permanent either: behind a captive portal
        // or with a wrong clock, the same request succeeds once the device is fixed.
        val tls = FakeServer(SSLHandshakeException("PKIX path building failed"))
        val error = assertFailsWith<IwlsException.Transient> { tls.client().stationList() }
        assertIs<SSLHandshakeException>(error.cause)
        assertEquals(emptyList(), tls.delays)
    }

    @Test fun aPermanentTransportLimitDoesNotRetry() = runTest {
        val limit = IwlsException.Permanent("IWLS response exceeds the body limit")
        val server = FakeServer(limit)
        assertSame(limit, assertFailsWith<IwlsException.Permanent> { server.client().stationList() })
        assertEquals(emptyList(), server.delays)
    }

    @Test fun onlyIwlsItselfMakesAFailurePermanent() = runTest {
        // Another HTTP stack can report being offline as something other than an IOException.
        val offline = FakeServer(java.nio.channels.UnresolvedAddressException())
        val error = assertFailsWith<IwlsException.Transient> { offline.client().stationList() }
        assertIs<java.nio.channels.UnresolvedAddressException>(error.cause)
        assertEquals(emptyList(), offline.delays)
    }

    @Test fun aTransportFailureThatOutlastsTheRetriesIsTransientWithItsCause() = runTest {
        val offline = FakeServer(*Array(4) { java.net.UnknownHostException("api-iwls.dfo-mpo.gc.ca") })
        val error = assertFailsWith<IwlsException.Transient> { offline.client().stationList() }
        assertIs<java.net.UnknownHostException>(error.cause)
        assertEquals(listOf(2.0, 4.0, 8.0), offline.delays)
    }

    @Test fun ignoresRetryAfterHeadersItCannotSleepFor() = runTest {
        for (header in listOf("nan", "Infinity", "-5", " 5", "0b1", "Wed, 21 Oct 2026 07:28:00 GMT")) {
            val server = FakeServer(429, 200, retryAfter = header)
            server.client().stationList()
            assertEquals(listOf(60.0), server.delays, header)
        }
    }

    @Test fun capsALongRetryAfterAtSixHundredSeconds() = runTest {
        val server = FakeServer(429, 200, retryAfter = "3600")
        server.client().stationList()
        assertEquals(listOf(600.0), server.delays)
    }

    @Test fun aMalformedBodyFailsWithoutRetry() = runTest {
        for (body in listOf("<html>busy</html>", """[{"id":"a","officialName":"x","latitude":0,"longitude":0}]""")) {
            val server = FakeServer(200, body = body)
            assertFailsWith<IwlsException.Permanent>(body) { server.client().stationList() }
            assertEquals(1, server.urls.size)
            assertEquals(emptyList(), server.delays)
        }
    }

    @Test fun aCloseDelimitedTruncationRetriesAndRecovers() = runTest {
        var calls = 0
        val delays = mutableListOf<Double>()
        val transport = IwlsTransport {
            calls++
            IwlsResponse(200, if (calls == 1) "[{\"id\":" else "[]", null, closeDelimited = true)
        }
        assertEquals(emptyList(), IwlsClient(transport, IwlsPacer(0)) { delays += it }.stationList())
        assertEquals(2, calls)
        assertEquals(listOf(2.0), delays)
    }

    @Test fun aCloseDelimitedTruncationRemainsTransientAfterFourAttempts() = runTest {
        var calls = 0
        val transport = IwlsTransport { calls++; IwlsResponse(200, "[", null, closeDelimited = true) }
        val error = assertFailsWith<IwlsException.Transient> {
            IwlsClient(transport, IwlsPacer(0)) {}.stationList()
        }
        assertIs<java.io.EOFException>(error.cause)
        assertEquals(4, calls)
    }

    @Test fun wellFormedCloseDelimitedJsonWithInvalidSchemaIsPermanent() = runTest {
        var calls = 0
        val transport = IwlsTransport { calls++; IwlsResponse(200, "[{}]", null, closeDelimited = true) }
        assertFailsWith<IwlsException.Permanent> { IwlsClient(transport, IwlsPacer(0)) {}.stationList() }
        assertEquals(1, calls)
    }

    @Test fun requestsAndKeepsTheRecipesFinerGrid() = runTest {
        val server = FakeServer(200, body = """[{"eventDate":"1970-01-01T00:03:00Z","value":2},{"eventDate":"1970-01-01T00:05:00Z","value":3}]""")
        assertEquals(listOf(ChsSample(180_000, 2.0)), server.client().series("wlp", "resolved", firstChunk, IwlsSampleGrid(3)))
        assertTrue(server.urls.single().query.contains("resolution=THREE_MINUTES"))
    }

    @Test fun retriesAnEmptyResponse() = runTest {
        // The contract counts an empty response as transient, as Swift's zeroByteResource is.
        var calls = 0
        val transport = IwlsTransport { calls++; IwlsResponse(200, if (calls == 1) "" else "[]", null) }
        val delays = mutableListOf<Double>()
        assertEquals(emptyList(), IwlsClient(transport, IwlsPacer(0)) { delays += it }.stationList())
        assertEquals(listOf(2.0), delays)
    }

    @Test fun retriesATransportsOwnTimeoutWhileTheCallerIsStillRunning() = runTest {
        // A transport that bounds its own call with withTimeout throws a cancellation the caller did not ask for.
        var calls = 0
        val transport = IwlsTransport {
            calls++
            if (calls == 1) withTimeout(1) { delay(10) }
            IwlsResponse(200, "[]", null)
        }
        val delays = mutableListOf<Double>()
        assertEquals(emptyList(), IwlsClient(transport, IwlsPacer(0)) { delays += it }.stationList())
        assertEquals(listOf(2.0), delays)
    }

    @Test fun readsMetadataForTheEncodedId() = runTest {
        val server = FakeServer(200, body = """{"floodDirection":45,"ebbDirection":null}""")
        assertEquals(IwlsMetadata(45.0, null), server.client().metadata("a/b"))
        assertEquals("/api/v1/stations/a%2Fb/metadata", server.urls.single().path)
    }

    @Test fun refusesARequestOutsideTheContractBeforeSendingIt() = runTest {
        val server = FakeServer()
        assertFailsWith<IwlsException.Permanent> { server.client().series("wlp-hilo", "id", firstChunk) }
        assertEquals(emptyList(), server.urls)
    }

    @Test fun retryAttemptsWaitForThePacer() = runTest {
        val server = FakeServer(503, 200)
        server.client(IwlsPacer(2_500_000_000L) { testScheduler.currentTime * 1_000_000 }).stationList()
        assertEquals(2_500L, testScheduler.currentTime)
    }

    @Test fun cancellationInterruptsABackoffAndSendsNothingMore() = runTest {
        val server = FakeServer(429, 200, retryAfter = "600")
        val client = IwlsClient(server.transport, IwlsPacer(0))
        val pending = launch { client.stationList() }
        advanceTimeBy(1_000)
        pending.cancelAndJoin()
        assertTrue(pending.isCancelled)
        assertEquals(1, server.urls.size)
    }

    @Test fun defaultClientsShareOnePacer() {
        assertSame(IwlsClient.sharedPacer, IwlsClient().pacer)
        assertSame(IwlsClient.sharedPacer, IwlsClient(FakeServer().transport).pacer)
        assertEquals(2_500L, IwlsClient.sharedPacer.intervalMillis)
    }
}
