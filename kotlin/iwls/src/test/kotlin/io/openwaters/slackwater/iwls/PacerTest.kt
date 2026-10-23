package io.openwaters.slackwater.iwls

import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class PacerTest {
    private fun TestScope.virtualPacer(intervalMillis: Long = 2_500, nanosPerMilli: Long = 1_000_000) =
        IwlsPacer(intervalMillis * 1_000_000) { testScheduler.currentTime * nanosPerMilli }

    @Test fun admitsWaitersOneIntervalApart() = runTest {
        val pacer = virtualPacer()
        val admitted = mutableListOf<Long>()
        List(3) { launch { pacer.await(); admitted += testScheduler.currentTime } }.joinAll()
        assertEquals(listOf(0L, 2_500L, 5_000L), admitted)
    }

    @Test fun neverAdmitsBeforeTheIntervalHasPassed() = runTest {
        // A clock that runs slow against the timer stands in for a timer that fires early.
        val pacer = virtualPacer(nanosPerMilli = 999_000)
        val clock = mutableListOf<Long>()
        repeat(3) { pacer.await(); clock += testScheduler.currentTime * 999_000 }
        assertTrue(clock.zipWithNext { a, b -> b - a }.all { it >= 2_500_000_000 }, clock.toString())
    }

    @Test fun aCancelledWaiterGivesUpItsSlot() = runTest {
        val pacer = virtualPacer()
        pacer.await()
        val cancelled = launch { pacer.await() }
        advanceTimeBy(100)
        cancelled.cancelAndJoin()
        pacer.await()
        assertEquals(2_500L, testScheduler.currentTime)
    }

    @Test fun aQueuedWaiterCancelsWithoutWaitingItsTurn() = runTest {
        val pacer = virtualPacer()
        pacer.await()
        val ahead = launch { pacer.await() }
        val queued = launch { pacer.await() }
        advanceTimeBy(100)
        queued.cancelAndJoin()
        assertEquals(100L, testScheduler.currentTime)
        ahead.join()
        pacer.await()
        assertEquals(5_000L, testScheduler.currentTime)
    }

    @Test fun usesTheMonotonicClockByDefault() = runBlocking {
        val pacer = IwlsPacer(20)
        assertEquals(20L, pacer.intervalMillis)
        val began = System.nanoTime()
        pacer.await()
        pacer.await()
        assertTrue(System.nanoTime() - began >= 20_000_000)
        assertEquals(2_500L, IwlsPacer().intervalMillis)
    }
}
