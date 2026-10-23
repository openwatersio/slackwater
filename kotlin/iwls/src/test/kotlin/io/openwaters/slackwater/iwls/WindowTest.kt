package io.openwaters.slackwater.iwls

import java.time.Instant
import java.time.ZoneId
import kotlin.test.*
import kotlinx.serialization.json.*

class WindowTest {
    @Test fun followsTheContractVersion() {
        assertEquals(2, fixture().getValue("version").jsonPrimitive.int)
    }

    @Test fun anchorsAtTheStationsLocalMidnightAcrossDst() {
        for (row in fixture().array("midnights").map { it.jsonObject }) {
            val now = Instant.parse(row.string("now"))
            val expected = Instant.parse(row.string("expected"))
            assertEquals(expected, IwlsFetch.localMidnight(now, ZoneId.of(row.string("timeZone"))), row.string("now"))
        }
    }

    @Test fun plansNewestFirstChunksOnTheEpochGrid() {
        for (row in fixture().array("plans").map { it.jsonObject }) {
            val plan = IwlsFetch.chunkPlan(row.double("days"), Instant.ofEpochSecond(row.long("endSeconds")))
            val expected = row.array("expected").map { pair -> pair.jsonArray.map { it.jsonPrimitive.long } }
            assertEquals(expected, plan.map { listOf(it.start.epochSecond, it.end.epochSecond) }, row.toString())
        }
    }

    @Test fun aShortPlanIsTheNewestPartOfALongOne() {
        val end = Instant.ofEpochSecond(1_785_000_000)
        val short = IwlsFetch.chunkPlan(60.0, end)
        val long = IwlsFetch.chunkPlan(210.0, end)
        assertEquals(short, long.take(short.size))
        val tomorrow = IwlsFetch.chunkPlan(210.0, end.plusSeconds(86_400))
        val kept = long.filter { it.isCacheable }.toSet()
        assertTrue(tomorrow.count { it.isCacheable && it in kept } >= 28)
    }

    @Test fun cachesOnlyFullNonEmptyWeeks() {
        val week = ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_800))
        assertTrue(week.canCache(listOf(ChsSample(0, 1.0), ChsSample(604_800_000, 1.0))))
        assertFalse(week.canCache(emptyList()))
        assertFalse(ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(900)).canCache(listOf(ChsSample(0, 1.0))))
        assertFalse(ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_800, 1)).isCacheable)
    }

    @Test fun fractionalEndClosesTheLastChunkExactly() {
        val end = Instant.ofEpochSecond(691_200, 500_000_000)
        val plan = IwlsFetch.chunkPlan(7.0, end)
        assertEquals(end, plan.first().end)
        assertEquals(Instant.ofEpochSecond(604_800), plan.first().start)
    }

    @Test fun anEndJustPastAWeekBoundaryStillPlansAtMostAWeekPerChunk() {
        // Near 1.8e9 s a Double resolves about 0.24 µs, so 100 ns past a boundary rounds onto it.
        val boundary = 2_952L * 604_800
        val end = Instant.ofEpochSecond(boundary, 100)
        val plan = IwlsFetch.chunkPlan(60.0, end)
        assertEquals(ChsChunk(Instant.ofEpochSecond(boundary), end), plan[0])
        assertEquals(ChsChunk(Instant.ofEpochSecond(boundary - 604_800), Instant.ofEpochSecond(boundary)), plan[1])
        assertTrue(plan.all { java.time.Duration.between(it.start, it.end) <= java.time.Duration.ofDays(7) })
    }

    @Test fun onlyAWeekOnTheEpochGridIsCacheable() {
        // Its identity is its start, so a week off the grid would be stored under a key no plan asks for.
        assertFalse(ChsChunk(Instant.ofEpochSecond(1_000), Instant.ofEpochSecond(605_800)).isCacheable)
        assertTrue(ChsChunk(Instant.ofEpochSecond(-604_800), Instant.EPOCH).isCacheable)
    }

    @Test fun rejectsDurationsItCannotPlan() {
        for (days in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException>(days.toString()) { IwlsFetch.chunkPlan(days, Instant.EPOCH) }
        }
    }
}
