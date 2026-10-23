package io.openwaters.slackwater

import java.io.File
import java.time.Instant
import kotlin.math.abs
import kotlin.math.min
import kotlinx.serialization.json.*

internal fun fixture(name: String): JsonObject = Json.parseToJsonElement(
    File(System.getProperty("fixtures"), "$name.json").readText()
).jsonObject
internal fun JsonElement.obj() = jsonObject
internal fun JsonObject.array(key: String) = getValue(key).jsonArray
internal fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.double
internal fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.content
internal fun JsonObject.instant(key: String) = Instant.parse(string(key))
internal fun JsonObject.constituents(key: String = "constituents") = array(key).map {
    val c = it.obj()
    HarmonicConstituent(c.string("name"), c.number("amplitude"), c.number("phase"))
}
internal fun secondsBetween(a: Instant, b: Instant) = java.time.Duration.between(a, b).toNanos() / 1e9
internal fun JsonObject.current() = CurrentStation(constituents(), number("floodDirection"), number("ebbDirection"), number("offset"))
internal fun currentKind(value: String) = when (value) {
    "slack" -> CurrentEventKind.SLACK
    "maxFlood" -> CurrentEventKind.MAX_FLOOD
    "maxEbb" -> CurrentEventKind.MAX_EBB
    else -> error("Invalid fixture kind: $value")
}
internal fun JsonObject.subordinate(reference: CurrentStation) = SubordinateCurrentStation(
    reference, number("slackBeforeFloodOffset"), number("slackBeforeEbbOffset"),
    number("floodTimeOffset"), number("ebbTimeOffset"), number("floodSpeedRatio"), number("ebbSpeedRatio"),
    get("floodDirection")?.jsonPrimitive?.doubleOrNull, get("ebbDirection")?.jsonPrimitive?.doubleOrNull
)
internal fun angularDiff(a: Double, b: Double): Double {
    val d = abs(a - b) % 360
    return min(d, 360 - d)
}
