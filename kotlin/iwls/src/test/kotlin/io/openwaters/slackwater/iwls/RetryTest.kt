package io.openwaters.slackwater.iwls

import io.openwaters.slackwater.iwls.IwlsFetch.Outcome
import java.io.EOFException
import java.io.IOException
import java.net.*
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.*
import kotlinx.serialization.json.*

class RetryTest {
    @Test fun retriesObeyTheSharedContract() {
        for (row in fixture().array("retries").map { it.jsonObject }) {
            val delay = IwlsFetch.retryDelaySeconds(Outcome.Status(row.long("status").toInt()), row.long("attempt").toInt(), row.doubleOrNull("retryAfter"))
            assertEquals(row.doubleOrNull("delay"), delay, row.toString())
        }
    }

    @Test fun retriesWhatAnotherAttemptCouldGetPast() {
        val transient = listOf(SocketTimeoutException(), ConnectException(), NoRouteToHostException(), PortUnreachableException(),
            SocketException("Connection reset"), UnknownHostException(), ProtocolException(), EOFException())
        for (error in transient) assertEquals(2.0, IwlsFetch.retryDelaySeconds(Outcome.Failure(error), 1), error.toString())
        val final = listOf(SSLHandshakeException("expired"), SSLHandshakeException("bad cert"), CancellationException(), IllegalStateException())
        for (error in final) assertNull(IwlsFetch.retryDelaySeconds(Outcome.Failure(error), 1), error.toString())
        assertEquals(listOf(2.0, 4.0, 8.0, null), (1..4).map { IwlsFetch.retryDelaySeconds(Outcome.Failure(EOFException()), it) })
    }

    @Test fun retriesTheWaysAndroidReportsADroppedLink() {
        // Conscrypt reports a reset under TLS as a bare SSLException; Android's HttpURLConnection
        // wraps a connection closed before the status line as an IOException around an EOFException.
        val reset = SSLException("Read error: ssl=0x7b: I/O error during system call, Connection reset by peer")
        val endOfStream = IOException("unexpected end of stream on https://api-iwls.dfo-mpo.gc.ca/...", EOFException("\\n not found"))
        val wrapped = IOException("failed", SocketTimeoutException())
        for (error in listOf(reset, endOfStream, wrapped)) assertTrue(IwlsFetch.isTransient(error), error.toString())
        // A certificate or trust failure is the same answer next time.
        val handshake = SSLHandshakeException("Chain validation failed").apply { initCause(java.security.cert.CertificateException("expired")) }
        val wrappedHandshake = SSLException("connection failed", SSLHandshakeException("Chain validation failed"))
        // The JDK reports a server that does not speak this TLS as a bare SSLException, the same every time.
        val unrecognised = SSLException("Unsupported or unrecognized SSL message")
        for (error in listOf(handshake, javax.net.ssl.SSLPeerUnverifiedException("bad host"), wrappedHandshake, unrecognised)) {
            assertFalse(IwlsFetch.isTransient(error), error.toString())
        }
    }

    @Test fun retriesALinkThatDropsDuringTheTlsHandshake() {
        // The JDK and Conscrypt report a reset during the handshake or a TLS read as handshake or
        // protocol failures; the next attempt over a working link succeeds.
        val dropped = listOf(
            SSLHandshakeException("Remote host terminated the handshake").apply { initCause(EOFException("SSL peer shut down incorrectly")) },
            javax.net.ssl.SSLProtocolException("Connection reset").apply { initCause(SocketException("Connection reset")) },
            SSLHandshakeException("SSL handshake aborted: ssl=0x7b: I/O error during system call, Connection reset by peer"),
        )
        for (error in dropped) assertTrue(IwlsFetch.isTransient(error), error.toString())
    }

    @Test fun retriesAnyLostConnectionTheStackReportsAsAPlainIOException() {
        // The JDK's chunked reader reports a body cut off mid-transfer this way, with no cause; a
        // queue told it was permanent would drop a chunk the next attempt would fetch.
        for (error in listOf(IOException("Premature EOF"), IOException("stream was reset: CANCEL"), IOException("other", IllegalStateException()))) {
            assertTrue(IwlsFetch.isTransient(error), error.toString())
        }
    }

    @Test fun ignoresRetryAfterValuesNoClientCanSleepFor() {
        for (header in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -5.0)) {
            assertEquals(60.0, IwlsFetch.retryDelaySeconds(Outcome.Status(429), 1, header))
            assertEquals(2.0, IwlsFetch.retryDelaySeconds(Outcome.Status(503), 1, header))
        }
        assertEquals(600.0, IwlsFetch.retryDelaySeconds(Outcome.Status(429), 1, 3600.0))
    }

    @Test fun readsRetryAfterAsDecimalSecondsOnly() {
        assertEquals(90.0, IwlsFetch.parseRetryAfter("90"))
        assertEquals(100.0, IwlsFetch.parseRetryAfter("1e2"))
        assertEquals(0.5, IwlsFetch.parseRetryAfter(".5"))
        for (header in listOf(null, "", " 5", "nan", "Infinity", "0b1", "0x10", "Wed, 21 Oct 2026 07:28:00 GMT")) {
            assertNull(IwlsFetch.parseRetryAfter(header), header.toString())
        }
    }

    @Test fun clientErrorsArePermanentAndTheRestTransient() {
        assertIs<IwlsException.Permanent>(IwlsFetch.terminalError(404)).also { assertEquals("HTTP 404", it.message) }
        assertIs<IwlsException.Transient>(IwlsFetch.terminalError(429)).also { assertEquals("HTTP 429", it.message) }
        assertIs<IwlsException.Transient>(IwlsFetch.terminalError(503))
        assertIs<IwlsException.Transient>(IwlsFetch.terminalError(302))
    }
}
