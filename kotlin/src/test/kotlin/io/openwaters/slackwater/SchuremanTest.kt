package io.openwaters.slackwater

import kotlin.math.abs
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.serialization.json.*

class SchuremanTest {
    @Test fun fundamentalsMatchEquationValues() {
        val fixture = fixture("schureman-equations")
        val astronomy = Astro(fixture.getValue("astronomy").obj().mapValues { it.value.jsonPrimitive.double })
        val catalog = Catalog.shared.correctedWith(NodeCorrections.Schureman, emptyList())
        for ((name, raw) in fixture.getValue("corrections").obj()) {
            val expected = raw.obj()
            val correction = catalog.correction(name, astronomy)
            assertTrue(abs(correction.f - expected.number("f")) < 1e-6, "$name amplitude factor")
            assertTrue(angularDiff(correction.uDegrees, expected.number("u")) < 1e-6, "$name phase correction")
        }
        val m1 = fixture.getValue("corrections").obj().getValue("M1").obj()
        val withoutPerigee = requireNotNull(schuremanCorrection("M1", astronomy, 0.0))
        assertTrue(angularDiff(withoutPerigee.uDegrees, m1.number("u") + astronomy["p"]) < 1e-6)
    }

    @Test fun predictsTidesAndCurrentsLikeSlackwater() {
        val fixture = fixture("prediction-schureman")
        val constituents = fixture.constituents()
        val definitions = fixture.array("definitions").map { raw ->
            val line = raw.obj()
            ConstituentDefinition(line.string("name"), line.number("speed"),
                line.array("coefficients").map { it.jsonPrimitive.int },
                members = line.array("members").map { rawMember ->
                    val member = rawMember.obj()
                    ConstituentDefinition.Member(member.string("name"), member.number("factor"))
                })
        }
        val tide = Station(constituents, definitions = definitions, nodeCorrections = NodeCorrections.Schureman)
        val current = CurrentStation(constituents, 0.0, 180.0, minorConstituents = constituents,
            azimuthDegrees = 0.0, definitions = definitions, nodeCorrections = NodeCorrections.Schureman)
        for (raw in fixture.array("points")) {
            val point = raw.obj()
            val time = point.instant("time")
            val expected = point.number("height")
            val height = tide.heights(time, time, 1.0).single().heightMetres
            val flow = current.speeds(time, time, 1.0).single()
            assertTrue(abs(height - expected) < 1e-6, "tide at $time")
            assertTrue(abs(flow.speedKnots - expected) < 1e-6, "major axis at $time")
            assertTrue(abs(flow.magnitudeKnots - abs(expected) * sqrt(2.0)) < 1e-6, "both axes at $time")
        }
    }
}
