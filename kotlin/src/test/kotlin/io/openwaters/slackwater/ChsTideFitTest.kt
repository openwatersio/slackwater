package io.openwaters.slackwater

import kotlin.test.*
import kotlinx.serialization.json.jsonPrimitive

class ChsTideFitTest {
    @Test fun matchesTheSharedRecipe() {
        val recipe = fixture("chs-tide-fit")
        assertEquals(recipe.array("basis").map { it.jsonPrimitive.content }, ChsTideFit.basis)
        assertEquals(recipe.number("days").toInt(), ChsTideFit.DAYS)
        assertEquals(recipe.number("sampleMinutes").toInt(), ChsTideFit.SAMPLE_MINUTES)
        for (name in ChsTideFit.basis) assertNotNull(Catalog.speed(name), name)
    }
}
