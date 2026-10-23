package io.openwaters.slackwater

import kotlin.math.abs
import kotlin.test.*

class TideAccuracyTest {
    @Test fun fridayHarborMatchesNoaa() {
        val f = fixture("realworld-friday-harbor")
        val s = Station(f.constituents(), f.number("offset"))
        val actual = s.extremes(f.instant("start").minusSeconds(3600), f.instant("end").plusSeconds(3600))
        assertTrue(f.array("official").isNotEmpty())
        for (item in f.array("official")) {
            val e = item.obj()
            val closest = assertNotNull(actual.filter { it.kind.name.lowercase() == e.string("kind") }.minByOrNull { abs(secondsBetween(it.time, e.instant("time"))) })
            assertTrue(abs(secondsBetween(closest.time, e.instant("time"))) / 60 < 15, e.string("time"))
            assertTrue(abs(closest.heightMetres - e.number("height")) < 0.15)
        }
    }
}
