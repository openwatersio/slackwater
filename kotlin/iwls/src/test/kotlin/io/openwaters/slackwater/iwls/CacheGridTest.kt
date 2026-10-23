package io.openwaters.slackwater.iwls

import java.time.Instant
import kotlin.test.*
import kotlinx.serialization.json.*

class CacheGridTest {
    @Test fun usesTheRecipeGridForRequestsAndSamples() {
        for (element in fixture().array("sampleGrids")) {
            val row = element.jsonObject
            val grid = IwlsSampleGrid(row.long("minutes").toInt())
            assertEquals(row.string("resolution"), grid.resolution)
            assertEquals(row.getValue("expected").samples(), IwlsFetch.onGrid(row.getValue("input").samples(), grid))
            assertTrue(IwlsFetch.dataUrl("wlp", "resolved", ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(900)), grid).query.contains("resolution=${grid.resolution}"))
        }
        for (minutes in fixture().array("unsupportedSampleMinutes")) {
            assertFailsWith<IwlsException.Permanent> { IwlsSampleGrid(minutes.jsonPrimitive.int) }
        }
    }

    @Test fun cachePolicyFollowsTheSharedFixture() {
        for (element in fixture().array("chunkCache")) {
            val row = element.jsonObject
            val chunk = ChsChunk(Instant.ofEpochMilli(row.long("startMs")), Instant.ofEpochMilli(row.long("endMs")))
            val storedGrid = IwlsSampleGrid(row.long("storedSampleMinutes").toInt())
            val samples = row.getValue("samples").samples()
            assertEquals(row.getValue("canCache").jsonPrimitive.boolean, chunk.canCache(samples, storedGrid), row.string("name"))
            val entry = IwlsChunkCacheEntry.create(chunk, samples, storedGrid, Instant.ofEpochMilli(row.long("fetchedAtMs")))
            assertEquals(row.getValue("canCreate").jsonPrimitive.boolean, entry != null, row.string("name"))
            val reusable = entry?.isReusable(chunk, IwlsSampleGrid(row.long("sampleMinutes").toInt()), Instant.ofEpochMilli(row.long("nowMs"))) ?: false
            assertEquals(row.getValue("reusable").jsonPrimitive.boolean, reusable, row.string("name"))
        }
    }

    @Test fun defaultsKeepTheFifteenMinuteCacheIdentity() {
        val chunk = ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_800))
        val samples = listOf(ChsSample(0, 1.0), ChsSample(180_000, 2.0), ChsSample(604_800_000, 1.0))
        assertNull(IwlsChunkCacheEntry.create(chunk, samples, fetchedAt = Instant.EPOCH))
        val fineEntry = assertNotNull(IwlsChunkCacheEntry.create(chunk, samples, IwlsSampleGrid(3), Instant.EPOCH))
        assertFalse(fineEntry.isReusable(chunk, now = Instant.EPOCH))
        val defaultEntry = assertNotNull(IwlsChunkCacheEntry.create(chunk, samples.filter { it.tMillis != 180_000L }, fetchedAt = Instant.EPOCH))
        assertTrue(defaultEntry.isReusable(chunk, now = Instant.ofEpochSecond(10_000_000)))
    }

    @Test fun storedMetadataCannotPromoteIncompleteOrWrongWeeks() {
        val chunk = ChsChunk(Instant.EPOCH, Instant.ofEpochSecond(604_800))
        val grid = IwlsSampleGrid(15)
        val entry = assertNotNull(IwlsChunkCacheEntry.create(chunk, listOf(ChsSample(0, 1.0), ChsSample(604_800_000, 1.0)), grid, Instant.EPOCH))
        assertFalse(entry.copy(samples = listOf(ChsSample(0, 1.0))).isReusable(chunk, grid, Instant.EPOCH))
        assertFalse(entry.isReusable(ChsChunk(chunk.end, chunk.end.plusSeconds(604_800)), grid, Instant.EPOCH))
        assertNull(IwlsChunkCacheEntry.create(chunk, listOf(ChsSample(0, Double.NaN)), grid, Instant.EPOCH))
    }
}
