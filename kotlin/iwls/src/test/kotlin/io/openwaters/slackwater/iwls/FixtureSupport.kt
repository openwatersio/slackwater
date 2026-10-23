package io.openwaters.slackwater.iwls

import java.io.File
import kotlinx.serialization.json.*

internal fun fixture(): JsonObject = Json.parseToJsonElement(
    File(System.getProperty("fixtures"), "iwls-fetch.json").readText()
).jsonObject

internal fun JsonObject.array(key: String) = getValue(key).jsonArray
internal fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.content
internal fun JsonObject.long(key: String) = getValue(key).jsonPrimitive.long
internal fun JsonObject.double(key: String) = getValue(key).jsonPrimitive.double
internal fun JsonObject.doubleOrNull(key: String) = (get(key) as? JsonPrimitive)?.doubleOrNull
internal fun JsonElement.samples() = jsonArray.map {
    val o = it.jsonObject
    ChsSample(o.long("t"), o.double("v"))
}
