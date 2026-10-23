package io.openwaters.slackwater

/**
 * How every Slackwater client fits a Canadian Hydrographic Service tide port
 * from IWLS `wlp` predictions: [DAYS] of samples on a [SAMPLE_MINUTES] grid,
 * fitted with [basis]. TypeScript's `chsTideFit` and Swift's `ChsTideFit` carry
 * the same values, and all three are checked against `fixtures/chs-tide-fit.json`.
 *
 * The basis has no SA or SSA: a 60-day window cannot separate them from the
 * mean, so a fit carries the mean level of its own window.
 */
object ChsTideFit {
    val basis: List<String> = listOf(
        "M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1",
        "M4", "MS4", "MN4", "2N2", "MU2", "NU2", "L2", "T2",
        "J1", "MM", "MSF", "MF", "M6", "S4", "M3",
    )
    const val DAYS = 60
    const val SAMPLE_MINUTES = 15
}
