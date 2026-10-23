package io.openwaters.slackwater.iwls

import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Admits request starts one at a time, at least the interval apart on the monotonic clock.
 * The gap runs from when the previous request was actually admitted, so a stalled thread
 * cannot release a burst, and a waiter cancelled before its turn takes no slot.
 */
internal class IwlsPacer(private val intervalNanos: Long, private val nanoTime: () -> Long) {
    constructor(intervalMillis: Long = 2_500) : this(intervalMillis * 1_000_000, System::nanoTime)

    val intervalMillis: Long get() = intervalNanos / 1_000_000

    private val mutex = Mutex()
    private var last: Long? = null

    suspend fun await() {
        mutex.withLock {
            val previous = last
            if (previous != null) {
                val due = previous + intervalNanos
                // Timers can fire just short of the time asked for; wait again until the clock agrees.
                while (true) {
                    val remaining = due - nanoTime()
                    if (remaining <= 0) break
                    delay((remaining + 999_999) / 1_000_000)
                }
            }
            last = nanoTime()
        }
    }
}
