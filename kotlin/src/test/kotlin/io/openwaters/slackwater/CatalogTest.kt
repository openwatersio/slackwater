package io.openwaters.slackwater

import java.time.Instant
import kotlin.test.*
import kotlin.math.abs

class CatalogTest {
    @Test fun constituentValuesMatchFixtures() {
        for (item in fixture("constituents").array("entries")) {
            val entry = item.obj()
            for ((name, value) in entry.getValue("constituents").obj()) {
                val expected = value.obj()
                val actual = assertNotNull(constituentAstronomy(name, entry.instant("time")))
                assertTrue(angularDiff(actual.v0Degrees, expected.number("v0")) < 1e-6, name)
                assertTrue(angularDiff(actual.uDegrees, expected.number("u")) < 1e-6, name)
                assertTrue(abs(actual.nodalFactor - expected.number("f")) < 1e-6, name)
                assertTrue(angularDiff(actual.v0PlusUDegrees, expected.number("v0") + expected.number("u")) < 1e-6)
                assertTrue(actual.v0PlusUDegrees >= 0 && actual.v0PlusUDegrees < 360)
            }
        }
    }
    @Test fun aliasesMatchAndUnknownAstronomyIsNull() {
        val t = Instant.parse("2026-01-01T00:00:00Z")
        assertEquals(constituentAstronomy("nu2", t), constituentAstronomy("NU2", t))
        assertNull(constituentAstronomy("unknown", t))
        // IHO gives these an alphabetical XDO only; the catalog carries it.
        for (name in listOf("3(SM)N2", "(SK)K5", "4ML12", "5MSN12")) {
            assertNotNull(constituentAstronomy(name, t), name)
        }
        val a = astro(t)
        assertEquals(0.0, Catalog.v0("unknown", a))
        assertEquals(NodeCorrection(1.0, 0.0), Catalog.correction("unknown", a))
        assertNull(Catalog.speed("unknown"))
    }
}
