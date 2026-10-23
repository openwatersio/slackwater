package io.openwaters.slackwater.iwls

import kotlin.test.*
import kotlinx.serialization.json.*

class DecodeTest {
    @Test fun decodesWithAdjacentDuplicateSuppressionAndKeepsTheFitGrid() {
        for (row in fixture().array("decoding").map { it.jsonObject }) {
            val decoded = IwlsFetch.decode(row.getValue("raw").toString())
            assertEquals(row.getValue("expected").samples(), decoded, row.toString())
            assertEquals(row.getValue("grid").samples(), IwlsFetch.onGrid(decoded))
            assertEquals(row.getValue("grid").samples(), IwlsFetch.onGrid(row.getValue("expected").samples()))
        }
    }

    @Test fun keepsBoundaryDuplicatesAcrossResponses() {
        val f = fixture()
        val combined = f.array("boundaryResponses").flatMap { IwlsFetch.decode(it.toString()) }
        assertEquals(f.getValue("boundaryExpected").samples(), combined)
    }

    @Test fun rejectsMalformedBodies() {
        for (bad in listOf("{}", "", "[{\"eventDate\":\"1970-01-01T00:00:00Z\"}]",
            "[{\"eventDate\":\"bad\",\"value\":\"1\"}]", "[{\"value\":1}]")) {
            assertFails(bad) { IwlsFetch.decode(bad) }
        }
    }

    @Test fun readsTheDateFormsSwiftReads() {
        assertEquals(0L, IwlsFetch.parseEventDate("1970-01-01T05:30:00+05:30"))
        assertEquals(0L, IwlsFetch.parseEventDate("1970-01-01T05:30:00+0530"))
        assertNull(IwlsFetch.parseEventDate("1970-01-01T00:00:00.000Z"))
        assertNull(IwlsFetch.parseEventDate("2026-13-01T00:00:00Z"))
        assertNull(IwlsFetch.parseEventDate("1970-01-01 00:00:00Z"))
    }

    @Test fun filtersNegativeTimesOnTheGrid() {
        val samples = listOf(ChsSample(-900_000, 1.0), ChsSample(-60_000, 2.0))
        assertEquals(listOf(ChsSample(-900_000, 1.0)), IwlsFetch.onGrid(samples))
    }

    @Test fun decodesOptionalCurrentAxes() {
        assertEquals(IwlsMetadata(45.0, null), IwlsFetch.decodeMetadata("""{"floodDirection":45,"ebbDirection":null,"code":"x"}"""))
        assertEquals(IwlsMetadata(null, null), IwlsFetch.decodeMetadata("{}"))
        assertFails { IwlsFetch.decodeMetadata("""{"floodDirection":"45"}""") }
        assertFails { IwlsFetch.decodeMetadata("[]") }
    }
}
