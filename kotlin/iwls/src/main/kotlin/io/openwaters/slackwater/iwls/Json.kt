package io.openwaters.slackwater.iwls

import kotlinx.serialization.json.*

internal fun JsonObject.requireString(key: String): String {
    val value = get(key) as? JsonPrimitive
    require(value != null && value.isString) { "IWLS $key must be a string" }
    return value.content
}

internal fun JsonObject.requireNumber(key: String): Double =
    optionalNumber(key) ?: throw IllegalArgumentException("IWLS $key must be a number")

/** Absent and `null` are both no value; anything other than a number is malformed. */
internal fun JsonObject.optionalNumber(key: String): Double? {
    val value = get(key)
    if (value == null || value is JsonNull) return null
    val number = (value as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
    require(number != null) { "IWLS $key must be a number" }
    return number
}
