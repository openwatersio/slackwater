# SlackwaterIWLS

An MIT Swift client for the [IWLS fetching contract](../../../docs/iwls-fetch.md). Add the `SlackwaterIWLS` product from the root Swift package. It is independent of the `SlackwaterKit` prediction engine and supports the package's macOS 13, iOS 16, and watchOS 9 floors, plus FoundationNetworking on Linux.

```swift
import Foundation
import SlackwaterIWLS

let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("IwlsChunks", isDirectory: true)
let cache = IwlsChunkCache(directory: directory)
let client = IwlsClient(chunkCache: cache)
let stations = try await client.stationList()
let station = try IwlsFetch.resolve(
    name: "Requested place", latitude: 48.42, longitude: -123.37,
    series: "wlp", in: stations)
let end = IwlsFetch.localMidnight(
    now: Date(), timeZone: TimeZone(identifier: "America/Vancouver")!)
// Supply the sample step from your fitting recipe.
let grid = try IwlsSampleGrid(sampleMinutes: 15)
var samples: [ChsSample] = []
for chunk in IwlsFetch.chunkPlan(days: 60, end: end) {
    samples += try await client.series("wlp", stationID: station.id, chunk: chunk, grid: grid)
}
samples.sort { $0.t < $1.t }
```

The module owns chunk persistence, atomic writes, synchronization, backup exclusion, legacy migration, and expiry. The caller chooses a dedicated directory and owns queueing and fitting. Without a configured cache the client remains stateless. Use `cache.purge(station.id)` after fitting to remove positive chunks while retaining fresh empty weeks, `includingEmpty: true` for orphan cleanup, and `cache.reset()` to remove the whole directory. `series(cache: false)` bypasses reads and writes; `cacheEmpty: false` bypasses negative hits and writes while reusing positive chunks. `cache.samples(..., fetch:)` supplies the same behavior for a custom loader, which must fetch the requested grid. Synchronization is within one process; use separate directories for separate processes.

Pass the fitting recipe’s sample step through `IwlsSampleGrid`; supported steps are 1, 3, 5, 15, and 60 minutes. `IwlsChunkCacheEntry` validates full epoch weeks with both endpoints for permanent caching and empty filtered weeks for 24 hours. Different sample steps have separate identities. Preserve repeated timestamps when concatenating responses. `IwlsClient.metadata(stationID:)` retrieves current flood/ebb axes. The optional request observer receives elapsed seconds for each HTTP attempt, including pacing. `beforeRequest` can enforce an application's network policy before every attempt and again after pacing; a refusal exits immediately. Cache hits do not invoke it or the observer. A supplied `URLSession` owns its connectivity and timeout settings.

This client is for direct fetching on a user's device. It grants no right to redistribute CHS predictions through an API or CLI. The fixtures use synthetic values. See [LICENSE](LICENSE) for the module's MIT license and [the contract](../../../docs/iwls-fetch.md) for decoding, retries, and compatibility tests.
