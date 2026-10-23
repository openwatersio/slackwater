package io.openwaters.slackwater

import kotlin.test.*
import kotlin.math.abs

class AstronomyTest {
    @Test fun astronomyMatchesFixtures() {
        for (item in fixture("astronomy").array("values")) {
            val entry = item.obj()
            val actual = astro(entry.instant("time")).all
            for ((key, value) in entry.getValue("astro").obj()) {
                assertTrue(angularDiff(actual.getValue(key), value.toString().toDouble()) < 1e-6, key)
            }
        }
    }
    @Test fun nodeCorrectionsMatchFixtures() {
        for (item in fixture("node-corrections").array("entries")) {
            val entry = item.obj()
            val state = astro(entry.instant("time"))
            for ((name, value) in entry.getValue("corrections").obj()) {
                val expected = value.obj()
                val actual = Catalog.correction(name, state)
                assertTrue(abs(actual.f - expected.number("f")) < 1e-6, name)
                assertTrue(angularDiff(actual.uDegrees, expected.number("u")) < 1e-6, name)
            }
        }
    }
}
