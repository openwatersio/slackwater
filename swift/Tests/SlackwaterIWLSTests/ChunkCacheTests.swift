import XCTest
@testable import SlackwaterIWLS

final class ChunkCacheTests: XCTestCase {
    private let cache = IwlsChunkCache(directory: FileManager.default.temporaryDirectory
        .appendingPathComponent("iwls-cache-" + UUID().uuidString))
    override func tearDown() { cache.reset() }

    private func offlineClient() -> IwlsClient {
        IwlsClient(transport: { _ in throw URLError(.notConnectedToInternet) },
            pause: { _ in }, pacer: IwlsPacer(interval: 0), chunkCache: cache,
            beforeRequest: { throw URLError(.notConnectedToInternet) }, observeRequest: { _ in })
    }

    private let chunk = ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 604800))
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let samples = [ChsSample(t: 0, v: 1), ChsSample(t: 604800000, v: 2)]

    private func station() -> String { "cache-test-\(UUID().uuidString)" }

    private func cleanup(_ id: String) {
        cache.purge(id)
        try? FileManager.default.removeItem(at: cache.emptyURL(id, "wlp", chunk))
    }

    func testEnvelopeRoundTripsWithUnixMilliseconds() throws {
        let id = station()
        defer { cleanup(id) }
        cache.save(samples, id, "wlp", chunk, fetchedAt: now)
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        let data = try Data(contentsOf: cache.url(id, "wlp", chunk))
        let entry = try JSONDecoder().decode(IwlsChunkCacheEntry.self, from: data)
        XCTAssertEqual(entry.fetchedAtMs, now.timeIntervalSince1970 * 1000)
    }

    func testEmptyWeekExpiresAt24HoursAndRejectsClockReversal() throws {
        let id = station()
        defer { cleanup(id) }
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), [])
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now.addingTimeInterval(86399.999)), [])
        XCTAssertNil(cache.load(id, "wlp", chunk, now: now.addingTimeInterval(86400)))
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        XCTAssertNil(cache.load(id, "wlp", chunk, now: now.addingTimeInterval(-1)))
    }

    func testEmptyWeekSurvivesPositivePurgeAndCanResumeOffline() async throws {
        let id = station()
        defer { cleanup(id) }
        cache.save([], id, "wlp", chunk)
        cache.purge(id)
        let fetcher = offlineClient()
        let result = try await fetcher.series("wlp", stationID: id, chunk: chunk)
        XCTAssertEqual(result, [])
    }

    func testTruncatedAndPartialResponsesNeverCreateAnEntry() {
        let id = station()
        defer { cleanup(id) }
        for values in [Array(samples.prefix(1)), Array(samples.suffix(1))] {
            cache.save(values, id, "wlp", chunk, fetchedAt: now)
            XCTAssertNil(cache.load(id, "wlp", chunk, now: now))
        }
        let partial = ChsChunk(start: chunk.start, end: .init(timeIntervalSince1970: 900))
        cache.save([], id, "wlp", partial, fetchedAt: now)
        XCTAssertNil(cache.load(id, "wlp", partial, now: now))
    }

    func testLegacyDenseArraysMigrateOnlyAfterFilteringAndEndpointValidation() throws {
        let id = station()
        defer { cleanup(id) }
        let legacy = cache.legacyURL(id, "wlp", chunk)
        try FileManager.default.createDirectory(at: cache.directory, withIntermediateDirectories: true)
        let dense = samples + [ChsSample(t: 60000, v: 3)]
        try JSONEncoder().encode(dense).write(to: legacy)
        let finer = try IwlsSampleGrid(sampleMinutes: 5)
        XCTAssertNil(cache.load(id, "wlp", chunk, grid: finer, now: now))
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: cache.url(id, "wlp", chunk).path))
    }

    func testLegacyEmptyAndTruncatedArraysMiss() throws {
        let id = station()
        defer { cleanup(id) }
        let legacy = cache.legacyURL(id, "wlp", chunk)
        try FileManager.default.createDirectory(at: cache.directory, withIntermediateDirectories: true)
        let legacyValues: [[ChsSample]] = [[], Array(samples.prefix(1))]
        for values in legacyValues {
            try JSONEncoder().encode(values).write(to: legacy)
            XCTAssertNil(cache.load(id, "wlp", chunk, now: now))
        }
    }

    func testAnEmptyResponseCannotReplaceACompleteCachedWeek() throws {
        let id = station()
        defer { cleanup(id) }
        cache.save(samples, id, "wlp", chunk, fetchedAt: now)
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.emptyURL(id, "wlp", chunk).path))
    }

    func testAnEmptyResponsePreservesCompleteLegacySamples() throws {
        let id = station()
        defer { cleanup(id) }
        try FileManager.default.createDirectory(at: cache.directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(samples).write(to: cache.legacyURL(id, "wlp", chunk))
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.emptyURL(id, "wlp", chunk).path))
    }

    func testConcurrentReadsAndSavesNeverLoseAnExistingWeek() {
        let id = station()
        let cache = cache
        let chunk = chunk
        let samples = samples
        let now = now
        defer { cleanup(id) }
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        DispatchQueue.concurrentPerform(iterations: 400) { index in
            if index % 3 == 0 {
                cache.save(samples, id, "wlp", chunk, fetchedAt: now)
            } else if index % 3 == 1 {
                cache.save([], id, "wlp", chunk, fetchedAt: now)
            } else {
                XCTAssertNotNil(cache.load(id, "wlp", chunk, now: now))
            }
        }
    }

    func testFailedMigrationPreservesLegacySamplesForOfflineResume() throws {
        let id = station()
        defer { cleanup(id) }
        try FileManager.default.createDirectory(at: cache.url(id, "wlp", chunk), withIntermediateDirectories: true)
        let legacy = cache.legacyURL(id, "wlp", chunk)
        try JSONEncoder().encode(samples).write(to: legacy)
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacy.path))
    }

    func testRollbackSamplesSupersedeAnEarlierNegativeEntry() throws {
        let id = station()
        defer { cleanup(id) }
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        try JSONEncoder().encode(samples).write(to: cache.legacyURL(id, "wlp", chunk))
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.emptyURL(id, "wlp", chunk).path))
    }

    func testOnlineRetriesBypassEmptyWeeksButReusePositiveWeeks() async throws {
        let id = station()
        defer {
            cache.purge(id, includingEmpty: true)
        }
        let fetcher = offlineClient()
        cache.save([], id, "wcsp1", chunk)
        do {
            _ = try await fetcher.series("wcsp1", stationID: id, chunk: chunk, cacheEmpty: false)
            XCTFail("an online retry must reach the network after an empty week")
        } catch let error as URLError { XCTAssertEqual(error.code, .notConnectedToInternet) } catch { XCTFail("unexpected error: \(error)") }
        cache.save(samples, id, "wcsp1", chunk)
        let hit = try await fetcher.series("wcsp1", stationID: id, chunk: chunk, cacheEmpty: false)
        XCTAssertEqual(hit, samples)
    }

    func testPurgeExpiresEmptyWeeksAndOrphanPurgeRemovesFreshOnes() {
        let id = station()
        let other = station()
        defer {
            cache.purge(id, includingEmpty: true)
            cache.purge(other, includingEmpty: true)
        }
        let older = ChsChunk(start: chunk.start.addingTimeInterval(-604800), end: chunk.start)
        cache.save([], id, "wlp", older, fetchedAt: now.addingTimeInterval(-86400))
        cache.save([], id, "wlp", chunk, fetchedAt: now)
        cache.save([], other, "wlp", chunk, fetchedAt: now)
        cache.purge(id, now: now)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.emptyURL(id, "wlp", older).path))
        XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), [])
        cache.purge(id, includingEmpty: true, now: now)
        XCTAssertNil(cache.load(id, "wlp", chunk, now: now))
        XCTAssertEqual(cache.load(other, "wlp", chunk, now: now), [])
    }

    func testGridAndWindowAreValidatedEvenUnderTheWrongFilename() throws {
        let id = station()
        defer { cleanup(id) }
        let finer = try IwlsSampleGrid(sampleMinutes: 5)
        cache.save(samples, id, "wlp", chunk, fetchedAt: now)
        XCTAssertNotEqual(cache.url(id, "wlp", chunk), cache.url(id, "wlp", chunk, grid: finer))
        XCTAssertNil(cache.load(id, "wlp", chunk, grid: finer, now: now))
        try Data(contentsOf: cache.url(id, "wlp", chunk))
            .write(to: cache.url(id, "wlp", chunk, grid: finer))
        defer { try? FileManager.default.removeItem(at: cache.url(id, "wlp", chunk, grid: finer)) }
        XCTAssertNil(cache.load(id, "wlp", chunk, grid: finer, now: now))
        let other = ChsChunk(start: .init(timeIntervalSince1970: 604800), end: .init(timeIntervalSince1970: 1209600))
        try Data(contentsOf: cache.url(id, "wlp", chunk)).write(to: cache.url(id, "wlp", other))
        XCTAssertNil(cache.load(id, "wlp", other, now: now))
    }
    func testSeparateCacheInstancesShareCoherentTransitions() {
        let other = IwlsChunkCache(directory: cache.directory)
        let cache = cache
        let chunk = chunk
        let samples = samples
        let now = now
        cache.save([], "same", "wlp", chunk, fetchedAt: now)
        DispatchQueue.concurrentPerform(iterations: 200) { index in
            if index % 2 == 0 { other.save(samples, "same", "wlp", chunk, fetchedAt: now) }
            else { XCTAssertNotNil(cache.load("same", "wlp", chunk, now: now)) }
        }
    }

    func testResetClearsBothEntryTypesAndCanRecreateTheDirectory() throws {
        cache.save(samples, "positive", "wlp", chunk, fetchedAt: now)
        cache.save([], "empty", "wlp", chunk, fetchedAt: now)
        cache.reset()
        XCTAssertNil(cache.load("positive", "wlp", chunk, now: now))
        XCTAssertNil(cache.load("empty", "wlp", chunk, now: now))
        cache.save(samples, "positive", "wlp", chunk, fetchedAt: now)
        XCTAssertEqual(cache.load("positive", "wlp", chunk, now: now), samples)
#if !os(Linux)
        XCTAssertEqual(try cache.directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
#endif
    }

    func testPathComponentsDoNotEscapeTheDirectoryOrAliasOtherStations() {
        let ids = ["id/path%?", "id%2Fpath%25%3F", "id", "id-wlp-1"]
        for id in ids { cache.save(samples, id, "wlp", chunk, fetchedAt: now) }
        XCTAssertEqual(Set(ids.map { cache.url($0, "wlp", chunk) }).count, ids.count)
        for id in ids {
            XCTAssertEqual(cache.url(id, "wlp", chunk).deletingLastPathComponent().path, cache.directory.path)
            XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples)
        }
        cache.purge("id", includingEmpty: true)
        XCTAssertNil(cache.load("id", "wlp", chunk, now: now))
        for id in ids where id != "id" { XCTAssertEqual(cache.load(id, "wlp", chunk, now: now), samples) }
    }


    func testPartialRequestsPreserveCompletePositiveAndEmptyWeeks() async throws {
        let partial = ChsChunk(start: chunk.start, end: chunk.start.addingTimeInterval(86400))
        for values in [samples, []] {
            let id = station()
            defer { cleanup(id) }
            cache.save(values, id, "wlp", chunk)
            let result = try await cache.samples("wlp", stationID: id, chunk: partial) { [] }
            XCTAssertEqual(result, [])
            XCTAssertEqual(cache.load(id, "wlp", chunk), values)
        }
    }

    func testOtherGridWritesPreserveLegacyFifteenMinuteSamples() throws {
        let finer = try IwlsSampleGrid(sampleMinutes: 5)
        for values in [samples, []] {
            let id = station()
            defer { cleanup(id) }
            try FileManager.default.createDirectory(at: cache.directory, withIntermediateDirectories: true)
            try JSONEncoder().encode(samples).write(to: cache.legacyURL(id, "wlp", chunk))
            cache.save(values, id, "wlp", chunk, grid: finer)
            XCTAssertTrue(FileManager.default.fileExists(atPath: cache.legacyURL(id, "wlp", chunk).path))
            XCTAssertEqual(cache.load(id, "wlp", chunk), samples)
        }
    }
}
