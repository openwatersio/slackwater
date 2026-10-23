package io.openwaters.slackwater.iwls

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.ServerSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ThreadPoolExecutor
import java.net.URLStreamHandler
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.*
import kotlinx.coroutines.*

class TransportLimitsTest {
    private fun url(connection: (URL) -> HttpURLConnection): URL = URL(null, "http://offline/", object : URLStreamHandler() {
        override fun openConnection(url: URL) = connection(url)
    })

    private open class Reply(url: URL, private val length: Long = 2) : HttpURLConnection(url) {
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getResponseCode() = 200
        override fun getContentLengthLong() = length
        override fun getInputStream() = "[]".byteInputStream()
    }

    @Test fun oversizedBodiesStopBeforeBufferingTheWholeResponse() {
        val error = assertFailsWith<IwlsException.Permanent> {
            HttpUrlConnectionTransport().readBody(ByteArray(8 * 1024 * 1024 + 1).inputStream(), AtomicBoolean(false))
        }
        assertFalse(IwlsFetch.isTransient(error))
    }

    @Test fun oversizedDeclaredBodiesAreRejectedBeforeReading() = runBlocking {
        val error = assertFailsWith<IwlsException.Permanent> {
            HttpUrlConnectionTransport().get(url { object : Reply(it, 8L * 1024 * 1024 + 1) {
                override fun getInputStream() = error("must reject before reading")
            } })
        }
        assertFalse(IwlsFetch.isTransient(error))
    }

    @Test fun theBodyLimitIncludesAnExactlyFullResponse() {
        val bytes = ByteArray(8 * 1024 * 1024)
        assertContentEquals(bytes, HttpUrlConnectionTransport().readBody(bytes.inputStream(), AtomicBoolean(false)))
    }

    @Test fun onlyCloseDelimitedRepliesHaveUncertainFraming() = runBlocking {
        val transport = HttpUrlConnectionTransport()
        assertTrue(transport.get(url { Reply(it, -1) }).closeDelimited)
        assertFalse(transport.get(url { Reply(it) }).closeDelimited)
        assertFalse(transport.get(url { object : Reply(it, -1) {
            override fun getHeaderField(name: String): String? = if (name == "Transfer-Encoding") "Chunked" else null
        } }).closeDelimited)
    }

    @Test fun idleNetworkTimeoutsAreShorterThanTheWholeAttempt() = runBlocking {
        lateinit var reply: Reply
        HttpUrlConnectionTransport().get(url { Reply(it).also { value -> reply = value } })
        assertTrue(reply.connectTimeout in 1..15_000)
        assertTrue(reply.readTimeout in 1..15_000)
        assertEquals("identity", reply.getRequestProperty("Accept-Encoding"))
    }

    @Test fun cleanupCapacityIsBoundedWithoutDelayingCallerTimeouts() = runBlocking {
        val cleanup = HttpUrlConnectionTransport::class.java.getDeclaredField("cleanupThreads").apply { isAccessible = true }
            .get(null) as ThreadPoolExecutor
        val entered = CountDownLatch(2)
        val release = CountDownLatch(1)
        withTimeout(5_000) { while (cleanup.activeCount != 0 || cleanup.queue.isNotEmpty()) delay(10) }
        try {
            repeat(2) { cleanup.execute { entered.countDown(); release.await() } }
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            repeat(8) { cleanup.execute { release.await() } }
            assertEquals(2, cleanup.activeCount)
            assertEquals(8, cleanup.queue.size)
            withTimeout(1_000) {
                assertFailsWith<SocketTimeoutException> {
                    HttpUrlConnectionTransport(50).get(url { object : Reply(it) {
                        override fun getResponseCode(): Int { release.await(); return 200 }
                    } })
                }
            }
            assertEquals(8, cleanup.queue.size)
        } finally { release.countDown() }
        withTimeout(5_000) { while (cleanup.activeCount != 0 || cleanup.queue.isNotEmpty()) delay(10) }
    }

    @Test fun cancelledTricklingHeadersReleaseEveryRequestWorker() = runBlocking {
        val server = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
        val sockets = CopyOnWriteArrayList<java.net.Socket>()
        val entered = CountDownLatch(8)
        val stopped = AtomicBoolean(false)
        val acceptor = Thread {
            try {
                repeat(8) {
                    val socket = server.accept()
                    sockets.add(socket)
                    Thread {
                        try {
                            socket.use {
                                val output = it.getOutputStream()
                                output.write("HTTP/1.1 200 OK\r\nX-Slow: ".toByteArray())
                                output.flush()
                                entered.countDown()
                                while (!stopped.get()) {
                                    output.write('x'.code)
                                    output.flush()
                                    Thread.sleep(20)
                                }
                            }
                        } catch (_: Exception) {}
                    }.apply { isDaemon = true }.start()
                }
            } catch (_: IOException) {}
        }.apply { isDaemon = true; start() }
        val pool = HttpUrlConnectionTransport::class.java.getDeclaredField("threads").apply { isAccessible = true }
            .get(null) as ThreadPoolExecutor
        try {
            val slow = URL("http://127.0.0.1:${server.localPort}/")
            val requests = List(8) {
                async(Dispatchers.Default) { assertFailsWith<SocketTimeoutException> { HttpUrlConnectionTransport(1_000).get(slow) } }
            }
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            requests.awaitAll()
            withTimeout(5_000) { while (pool.activeCount != 0) delay(10) }
            assertEquals("[]", HttpUrlConnectionTransport().get(url { Reply(it) }).body)
        } finally {
            stopped.set(true)
            server.close()
            sockets.forEach { it.close() }
            acceptor.join(1_000)
        }
    }

    @Test fun abandonedRequestsCannotCreateUnboundedWorkersAndCapacityRecovers() = runBlocking {
        val entered = CountDownLatch(8)
        val release = CountDownLatch(1)
        val blocked = url { object : Reply(it) {
            override fun getResponseCode(): Int {
                entered.countDown()
                check(release.await(10, TimeUnit.SECONDS))
                return 200
            }
            override fun disconnect() { release.await(10, TimeUnit.SECONDS) }
        } }
        val pending = List(8) { launch(Dispatchers.Default) { HttpUrlConnectionTransport().get(blocked) } }
        try {
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            val error = withTimeout(1_000) {
                assertFailsWith<IOException> { HttpUrlConnectionTransport().get(url { Reply(it) }) }
            }
            assertTrue(IwlsFetch.isTransient(error))
            withTimeout(1_000) { pending.forEach { it.cancel() }; pending.joinAll() }
            // Caller cancellation must not free capacity still occupied by blocked workers.
            assertFailsWith<IOException> { HttpUrlConnectionTransport().get(url { Reply(it) }) }
        } finally {
            pending.forEach { it.cancel() }
            release.countDown()
            pending.joinAll()
        }
        withTimeout(5_000) {
            while (true) {
                try {
                    assertEquals("[]", HttpUrlConnectionTransport().get(url { Reply(it) }).body)
                    break
                } catch (error: IOException) { delay(10) }
            }
        }
    }
}
