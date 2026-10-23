import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import SlackwaterIWLS

private actor CacheServer {
    var requests = 0
    var observations = 0
    let body: String
    init(body: String) { self.body = body }
    func respond(_ url: URL) -> (Data, URLResponse) {
        requests += 1
        return (Data(body.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    func observe() { observations += 1 }
    func client(cache: IwlsChunkCache) -> IwlsClient {
        IwlsClient(transport: { await self.respond($0) }, pause: { _ in }, pacer: IwlsPacer(interval: 0),
            chunkCache: cache, observeRequest: { _ in await self.observe() })
    }
}

private let cacheWeek = ChsChunk(start: Date(timeIntervalSince1970: 0), end: Date(timeIntervalSince1970: 604800))
private let completeBody = "[{\"eventDate\":\"1970-01-01T00:00:00Z\",\"value\":1},{\"eventDate\":\"1970-01-08T00:00:00Z\",\"value\":2}]"
private func temporaryCache() -> IwlsChunkCache {
    IwlsChunkCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("iwls-client-" + UUID().uuidString))
}

@Test func configuredClientFetchesAndReusesAChunkWithoutPacingOrObservingAHit() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let server = CacheServer(body: completeBody)
    let client = await server.client(cache: cache)
    let first = try await client.series("wlp", stationID: "id", chunk: cacheWeek)
    #expect(first.count == 2)
    #expect(try await client.series("wlp", stationID: "id", chunk: cacheWeek) == first)
    #expect(await server.requests == 1)
    #expect(await server.observations == 1)
    await #expect(throws: IwlsError.self) { try await client.series("wlp-hilo", stationID: "id", chunk: cacheWeek) }
    #expect(await server.requests == 1)
}

@Test func cacheBypassDoesNotReadOrWriteChunks() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let server = CacheServer(body: completeBody)
    let client = await server.client(cache: cache)
    _ = try await client.series("wlp", stationID: "id", chunk: cacheWeek, cache: false)
    _ = try await client.series("wlp", stationID: "id", chunk: cacheWeek, cache: false)
    #expect(await server.requests == 2)
    #expect(cache.load("id", "wlp", cacheWeek) == nil)
}

@Test func emptyCacheExpiresAndPositiveOnlyRequestsStillReachTransport() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let server = CacheServer(body: "[]")
    let client = await server.client(cache: cache)
    _ = try await client.series("wcsp1", stationID: "id", chunk: cacheWeek)
    _ = try await client.series("wcsp1", stationID: "id", chunk: cacheWeek)
    #expect(await server.requests == 1)
    _ = try await client.series("wcsp1", stationID: "id", chunk: cacheWeek, cacheEmpty: false)
    #expect(await server.requests == 2)
    cache.save([], "id", "wcsp1", cacheWeek, fetchedAt: Date.now.addingTimeInterval(-86400))
    _ = try await client.series("wcsp1", stationID: "id", chunk: cacheWeek)
    #expect(await server.requests == 3)
}

@Test func fetchThroughReturnsAConcurrentPositiveInsteadOfAnEmptyAnswer() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let samples = [ChsSample(t: 0, v: 1), ChsSample(t: 604800000, v: 2)]
    let result = try await cache.samples("wlp", stationID: "id", chunk: cacheWeek) {
        cache.save(samples, "id", "wlp", cacheWeek)
        return []
    }
    #expect(result == samples)
}

@Test func cancelledFetchDoesNotPopulateTheCache() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let request = Task {
        try await cache.samples("wlp", stationID: "id", chunk: cacheWeek) {
            withUnsafeCurrentTask { $0?.cancel() }
            return []
        }
    }
    await #expect(throws: CancellationError.self) { try await request.value }
    #expect(cache.load("id", "wlp", cacheWeek) == nil)
}

@Test func failedPositiveWriteStillReturnsFetchedSamples() async throws {
    let cache = temporaryCache()
    defer { cache.reset() }
    let samples = [ChsSample(t: 0, v: 1), ChsSample(t: 604800000, v: 2)]
    let result = try await cache.samples("wlp", stationID: "id", chunk: cacheWeek) {
        cache.save([], "id", "wlp", cacheWeek)
        try FileManager.default.createDirectory(at: cache.url("id", "wlp", cacheWeek), withIntermediateDirectories: true)
        return samples
    }
    #expect(result == samples)
}

// The network-policy flag is shared with a request task and guarded by its lock.
private final class NetworkPolicy: @unchecked Sendable {
    private let lock = NSLock()
    private var allowed = true
    func disable() { lock.lock(); defer { lock.unlock() }; allowed = false }
    func check() throws {
        lock.lock(); defer { lock.unlock() }
        if !allowed { throw URLError(.notConnectedToInternet) }
    }
}

@Test func networkPolicyChangesStopRetriesWithoutRetryingTheDenial() async throws {
    let policy = NetworkPolicy()
    let server = CacheServer(body: "[]")
    let client = IwlsClient(transport: { url in
        _ = await server.respond(url)
        return (Data(), HTTPURLResponse(url: url, statusCode: 429, httpVersion: nil, headerFields: nil)!)
    }, pause: { _ in policy.disable() }, pacer: IwlsPacer(interval: 0),
       beforeRequest: { try policy.check() }, observeRequest: { _ in await server.observe() })
    await #expect(throws: URLError.self) { try await client.stationList() }
    #expect(await server.requests == 1)
    #expect(await server.observations == 1)
}

@Test func networkPolicyIsRecheckedAfterPacing() async throws {
    let policy = NetworkPolicy()
    let server = CacheServer(body: "[]")
    let pacer = IwlsPacer(interval: 0.1)
    try await pacer.wait()
    let (checks, continuation) = AsyncStream<Void>.makeStream()
    let client = IwlsClient(transport: { await server.respond($0) }, pause: { _ in }, pacer: pacer,
        beforeRequest: { continuation.yield(()); try policy.check() }, observeRequest: { _ in })
    let task = Task { try await client.stationList() }
    var iterator = checks.makeAsyncIterator()
    _ = await iterator.next()
    policy.disable()
    await #expect(throws: URLError.self) { try await task.value }
    #expect(await server.requests == 0)
    continuation.finish()
}
