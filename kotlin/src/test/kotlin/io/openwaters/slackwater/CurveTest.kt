package io.openwaters.slackwater

import java.time.Instant
import kotlin.test.*

class CurveTest {
    @Test fun curveContextStopsWhenKnotsCannotBeBracketed() {
        val t = Instant.EPOCH
        assertFailsWith<IllegalArgumentException> {
            curveKnots(t, t.plusSeconds(3600), 3600.0, 12 * 3600.0) { _, _ -> listOf(t to 1.0) }
        }
        assertEquals(emptyList(), curveKnots(t, t.plusSeconds(3600), 3600.0, 0.0) { _, _ -> emptyList() })
    }
    @Test fun curveClampsAndResolvesCoincidentKnots() {
        val t = Instant.EPOCH
        val items = listOf(t.minusSeconds(1), t, t.plusSeconds(1800), t.plusSeconds(3600), t.plusSeconds(3601))
        val curve = halfCosineCurve(listOf(t to 1.0, t to 2.0, t.plusSeconds(3600) to 4.0), items)
        assertEquals(listOf(2.0, 2.0, 3.0, 4.0, 4.0), curve.map { it.value })
        assertEquals(0.0, curve.first().ratePerHour)
        assertEquals(0.0, curve.last().ratePerHour)
        assertTrue(curve.all { it.value.isFinite() && it.ratePerHour.isFinite() })
        assertTrue(curve[2].ratePerHour > 0)
        assertTrue(halfCosineCurve(emptyList(), items).all { it.value == 0.0 && it.ratePerHour == 0.0 })
        assertTrue(halfCosineCurve(listOf(t to 3.0), items).all { it.value == 3.0 && it.ratePerHour == 0.0 })
    }
}
