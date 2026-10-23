package io.openwaters.slackwater.iwls

import java.net.URL
import java.net.URLDecoder
import java.time.Instant
import kotlin.test.*
import kotlinx.serialization.json.*

class RequestTest {
    private val chunk = ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(900))

    private fun URL.queryMap(): Map<String, String> = query.split("&").associate {
        val (key, value) = it.split("=", limit = 2)
        URLDecoder.decode(key, "UTF-8") to URLDecoder.decode(value, "UTF-8")
    }

    @Test fun requestsTheResolvedIdAtFifteenMinuteResolution() {
        val row = fixture().getValue("request").jsonObject
        val url = IwlsFetch.dataUrl(row.string("series"), row.string("stationID"),
            ChsChunk(Instant.ofEpochSecond(row.long("startSeconds")), Instant.ofEpochSecond(row.long("endSeconds"))))
        assertEquals(row.string("path"), url.path)
        assertEquals(row.getValue("query").jsonObject.mapValues { it.value.jsonPrimitive.content }, url.queryMap())
    }

    @Test fun encodesTheResolvedIdAsOnePathComponent() {
        for (row in fixture().array("pathComponents").map { it.jsonObject }) {
            val id = row.string("id")
            val encoded = (row["encoded"] as? JsonPrimitive)?.contentOrNull
            if (encoded == null) {
                assertFailsWith<IwlsException.Permanent>(id) { IwlsFetch.dataUrl("wlp", id, chunk) }
                assertFailsWith<IwlsException.Permanent>(id) { IwlsFetch.metadataUrl(id) }
            } else {
                assertEquals("/api/v1/stations/$encoded/data", IwlsFetch.dataUrl("wlp", id, chunk).path, id)
                assertEquals("/api/v1/stations/$encoded/metadata", IwlsFetch.metadataUrl(id).path, id)
            }
        }
    }

    @Test fun refusesEventSeriesAndWindowsLongerThanAWeek() {
        for (code in listOf("wlp-hilo", "wcp1-events", "")) {
            assertFailsWith<IwlsException.Permanent>(code) { IwlsFetch.dataUrl(code, "id", chunk) }
        }
        assertFailsWith<IwlsException.Permanent> { IwlsFetch.dataUrl("wlp", "id", ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_801))) }
        assertFailsWith<IwlsException.Permanent> { IwlsFetch.dataUrl("wlp", "id", ChsChunk(Instant.ofEpochSecond(900), Instant.EPOCH)) }
        assertFailsWith<IwlsException.Permanent> { IwlsFetch.dataUrl("wlp", "", chunk) }
        assertFailsWith<IwlsException.Permanent> { IwlsFetch.metadataUrl("") }
        assertEquals(IwlsFetch.dataUrl("wlp", "id", ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_800))).path, "/api/v1/stations/id/data")
    }

    @Test fun encodesTheIdAsOnePathComponent() {
        assertEquals("/api/v1/stations/id%2Fpath%3Fbad=2%23x%25/data", IwlsFetch.dataUrl("wcsp1", "id/path?bad=2#x%", chunk).path)
        assertEquals("/api/v1/stations/a%2Fb/metadata", IwlsFetch.metadataUrl("a/b").path)
        assertEquals("/api/v1/stations/a:b@c!\$&'()*+,;=-._~/metadata", IwlsFetch.metadataUrl("a:b@c!\$&'()*+,;=-._~").path)
        assertEquals("/api/v1/stations", IwlsFetch.stationsUrl.path)
    }

    @Test fun encodesNonAsciiIdsAsUtf8() {
        assertEquals("/api/v1/stations/%C3%A9t%20e/metadata", IwlsFetch.metadataUrl("ét e").path)
    }

    @Test fun requestTimesAreWholeSeconds() {
        val url = IwlsFetch.dataUrl("wlp", "id", ChsChunk(Instant.ofEpochSecond(0, 700_000_000), Instant.ofEpochSecond(900, 500_000_000)))
        assertEquals("1970-01-01T00:00:00Z", url.queryMap()["from"])
        assertEquals("1970-01-01T00:15:00Z", url.queryMap()["to"])
    }
}
