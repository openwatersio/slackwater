package io.openwaters.slackwater.iwls

import kotlin.test.*
import kotlinx.serialization.json.*

class ResolveTest {
    @Test fun resolvesByPositionAndSeriesNeverByName() {
        for (row in fixture().array("resolution").map { it.jsonObject }) {
            val stations = IwlsFetch.decodeStations(row.getValue("stations").toString())
            val resolve = {
                IwlsFetch.resolve(row.string("name"), row.double("latitude"), row.double("longitude"), row.string("series"), stations)
            }
            val expected = (row["expectedID"] as? JsonPrimitive)?.contentOrNull
            if (expected != null) assertEquals(expected, resolve().id, row.string("name"))
            else assertFailsWith<IwlsException.Permanent>(row.string("name")) { resolve() }
        }
    }

    @Test fun namesTheNearestStationWhenItIsTooFar() {
        val far = IwlsStation("far", "Far Away", 1.0, 0.0, listOf("wlp"))
        val error = assertFailsWith<IwlsException.Permanent> { IwlsFetch.resolve("Port", 0.0, 0.0, "wlp", listOf(far)) }
        assertEquals("Port: nearest wlp station Far Away is 111.2 km away", error.message)
        val none = assertFailsWith<IwlsException.Permanent> { IwlsFetch.resolve("Port", 0.0, 0.0, "wcsp1", listOf(far)) }
        assertEquals("no IWLS station serves wcsp1", none.message)
    }

    @Test fun decodesOnlyTheFieldsItUsesAndRejectsMissingOnes() {
        val json = """[{"id":"a","code":"07120","officialName":"Victoria","latitude":48.4,"longitude":-123.4,
            "operating":true,"timeSeries":[{"code":"wlp","id":"x"},{"code":"wlo"}]}]"""
        assertEquals(listOf(IwlsStation("a", "Victoria", 48.4, -123.4, listOf("wlp", "wlo"))), IwlsFetch.decodeStations(json))
        for (bad in listOf("{}", """[{"officialName":"x","latitude":0,"longitude":0,"timeSeries":[]}]""",
            """[{"id":"a","officialName":"x","latitude":"0","longitude":0,"timeSeries":[]}]""",
            """[{"id":"a","officialName":"x","latitude":null,"longitude":0,"timeSeries":[]}]""")) {
            assertFails(bad) { IwlsFetch.decodeStations(bad) }
        }
    }
}
