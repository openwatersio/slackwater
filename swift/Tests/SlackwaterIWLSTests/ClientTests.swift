import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import SlackwaterIWLS

private actor Server {
    var replies: [Result<Int, any Error>]
    var urls: [URL] = []
    var delays: [Double] = []
    var observations = 0
    let body: String
    let retryAfter: String?

    init(_ replies: [Result<Int, any Error>], body: String = "[]", retryAfter: String? = nil) {
        self.replies = replies; self.body = body; self.retryAfter = retryAfter
    }
    func respond(_ url: URL) throws -> (Data, URLResponse) {
        urls.append(url)
        let status = try replies.removeFirst().get()
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
            headerFields: retryAfter.map { ["Retry-After": $0] })!
        return (Data(body.utf8), response)
    }
    func pause(_ delay: Double) { delays.append(delay) }
    func observe(_ seconds: Double) { observations += 1 }
    func snapshot() -> ([URL], [Double], Int) { (urls, delays, observations) }
    func client(pacing interval: TimeInterval = 0) -> IwlsClient {
        IwlsClient(transport: { try await self.respond($0) },
            pause: { await self.pause($0) }, pacer: IwlsPacer(interval: interval),
            observeRequest: { await self.observe($0) })
    }
}

@Test func clientIgnoresRetryAfterHeadersItCannotSleepFor() async throws {
    for header in ["nan", "inf", "-5"] {
        let server = Server([.success(429), .success(200)], retryAfter: header)
        let client = await server.client()
        #expect(try await client.stationList().isEmpty)
        let (_, delays, _) = await server.snapshot()
        #expect(delays == [60], "Retry-After: \(header)")
    }
}

@Test func retryAttemptsWaitForThePacer() async throws {
    let server = Server([.success(503), .success(200)])
    let client = await server.client(pacing: 0.05)
    let began = ContinuousClock.now
    #expect(try await client.stationList().isEmpty)
    #expect(ContinuousClock.now - began >= .milliseconds(50))
}

@Test func clientRetriesRateLimitsAndDecodesGridSamples() async throws {
    let server = Server([.success(429), .success(503), .success(200)], body: """
        [{"eventDate":"1970-01-01T00:00:00Z","value":2},
         {"eventDate":"1970-01-01T00:01:00Z","value":3}]
        """, retryAfter: "90")
    let client = await server.client()
    let samples = try await client.series("wlp", stationID: "resolved", chunk: ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 900)))
    #expect(samples == [ChsSample(t: 0, v: 2)])
    let (urls, delays, observed) = await server.snapshot()
    #expect(urls.count == 3)
    #expect(delays == [90, 90])
    #expect(observed == 3)
    #expect(Set(urls).count == 1)
}

@Test func clientRetriesAnEmptyResponse() async throws {
    // A 200 with no body is the contract's empty response, retried as zeroByteResource is.
    let server = Server(Array(repeating: .success(200), count: 4), body: "")
    let client = await server.client()
    await #expect(throws: URLError.self) { try await client.stationList() }
    let (urls, delays, _) = await server.snapshot()
    #expect(urls.count == 4)
    #expect(delays == [2, 4, 8])
}

@Test func clientStopsAtFourAttempts() async throws {
    let server = Server(Array(repeating: .success(500), count: 4))
    let client = await server.client()
    await #expect(throws: IwlsError.transient("HTTP 500")) { try await client.stationList() }
    let (urls, delays, observed) = await server.snapshot()
    #expect(urls.count == 4)
    #expect(delays == [2, 4, 8])
    #expect(observed == 4)
}

@Test func clientRetriesDroppedLinksAndPreservesCancellation() async throws {
    let server = Server([.failure(URLError(.networkConnectionLost)), .success(200)])
    let client = await server.client()
    #expect(try await client.stationList().isEmpty)
    let (_, delays, _) = await server.snapshot()
    #expect(delays == [2])
    let cancelled = Server([.failure(CancellationError())])
    let cancelledClient = await cancelled.client()
    await #expect(throws: CancellationError.self) { try await cancelledClient.stationList() }
    let (urls, noDelays, _) = await cancelled.snapshot()
    #expect(urls.count == 1)
    #expect(noDelays.isEmpty)
}

@Test func clientStopsOnPermanentHTTPAndMalformedJSON() async throws {
    let server = Server([.success(404)])
    let client = await server.client()
    await #expect(throws: IwlsError.permanent("HTTP 404")) { try await client.stationList() }
    let (_, delays, _) = await server.snapshot()
    #expect(delays.isEmpty)
    let malformed = Server([.success(200)], body: "{}")
    let malformedClient = await malformed.client()
    await #expect(throws: (any Error).self) { try await malformedClient.stationList() }
}

@Test func clientFetchesMetadataAndStationList() async throws {
    let stations = Server([.success(200)], body: """
        [{"id":"id","officialName":"Station","latitude":0,"longitude":0,"timeSeries":[{"code":"wlp"}]}]
        """)
    let client = await stations.client()
    #expect(try await client.stationList().first?.id == "id")
    let metadata = Server([.success(200)], body: "{\"floodDirection\":45,\"ebbDirection\":225}")
    let metaClient = await metadata.client()
    let axis = try await metaClient.metadata(stationID: "id")
    #expect(axis.floodDirection == 45)
    #expect(axis.ebbDirection == 225)
    let (urls, _, _) = await metadata.snapshot()
    #expect(urls.first?.path == "/api/v1/stations/id/metadata")
}

@Test func aCancelledWaiterGivesUpItsSlot() async throws {
    let pacer = IwlsPacer(interval: 0.5)
    let began = ContinuousClock.now
    try await pacer.wait()
    let cancelled = Task { try await pacer.wait() }
    try await Task.sleep(for: .milliseconds(50))
    cancelled.cancel()
    _ = await cancelled.result
    try await pacer.wait()
    // A held slot would put this start at 1,000 ms; the bound leaves slack for loaded CI runners.
    let elapsed = ContinuousClock.now - began
    #expect(elapsed >= .milliseconds(499))
    #expect(elapsed < .milliseconds(950), "\(elapsed)")
}

@Test func aQueuedWaiterCancelsWithoutWaitingItsTurn() async throws {
    let pacer = IwlsPacer(interval: 0.5)
    try await pacer.wait()
    let ahead = Task { try await pacer.wait() }
    try await Task.sleep(for: .milliseconds(20))
    let queued = Task { try await pacer.wait() }
    try await Task.sleep(for: .milliseconds(50))
    let cancelledAt = ContinuousClock.now
    queued.cancel()
    let outcome = await queued.result
    #expect(ContinuousClock.now - cancelledAt < .milliseconds(250))
    #expect(throws: CancellationError.self) { try outcome.get() }
    try await ahead.value
}

@Test func sharedPacerSpacesConcurrentReservations() async throws {
    let pacer = IwlsPacer(interval: 0.02)
    let began = Date.now
    async let first: Void = pacer.wait()
    async let second: Void = pacer.wait()
    async let third: Void = pacer.wait()
    _ = try await (first, second, third)
    #expect(Date.now.timeIntervalSince(began) >= 0.04)
}

@Test func requestsRejectOverlongAndReversedWindows() throws {
    for chunk in [ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 604801)),
                  ChsChunk(start: .init(timeIntervalSince1970: 900), end: .init(timeIntervalSince1970: 0))] {
        #expect(throws: IwlsError.self) { try IwlsFetch.dataURL("wlp", stationID: "id", chunk: chunk) }
    }
    let chunk = ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 900))
    let url = try IwlsFetch.dataURL("wcsp1", stationID: "id/path?bad=2", chunk: chunk)
    #expect(url.absoluteString.contains("id%2Fpath%3Fbad=2/data"))
    let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(parts.queryItems?.first?.value == "wcsp1")
    // Off-grid event series and anything else outside the fit series are refused, not filtered to nothing.
    for code in ["wlp-hilo", "wcp1-events", "", "wlp&bad=1"] {
        #expect(throws: IwlsError.self) { try IwlsFetch.dataURL(code, stationID: "id", chunk: chunk) }
    }
}

private final class SuccessProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("[]".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Test func publicClientsShareTheProcessPacer() {
    #expect(IwlsClient().requestPacer === IwlsClient.pacer)
    #expect(IwlsClient(session: .shared).requestPacer === IwlsClient.pacer)
}

@Test func publicClientUsesURLSession() async throws {
    _ = IwlsClient()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [SuccessProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let client = IwlsClient(session: session)
    #expect(try await client.stationList().isEmpty)
}

@Test func callersCanCreateStationAndMetadataValues() throws {
    let station = IwlsStation(id: "a", officialName: "A", latitude: 0, longitude: 0, timeSeries: [.init(code: "wlp")])
    #expect(station.timeSeries.first?.code == "wlp")
    #expect(try JSONDecoder().decode(IwlsStation.self, from: JSONEncoder().encode(station)).id == "a")
    let metadata = IwlsClient.Metadata(floodDirection: nil, ebbDirection: nil)
    #expect(metadata.floodDirection == nil && metadata.ebbDirection == nil)
    #expect(IwlsError.permanent("reason").localizedDescription == "reason")
    #expect(IwlsError.transient("retry").localizedDescription == "retry")
}

@Test func nonHTTPResponseFailsWithoutRetry() async throws {
    let client = IwlsClient(transport: { url in
        (Data(), URLResponse(url: url, mimeType: nil, expectedContentLength: 0, textEncodingName: nil))
    }, pause: { _ in Issue.record("unexpected retry") }, pacer: IwlsPacer(interval: 0), observeRequest: { _ in })
    await #expect(throws: IwlsError.transient("HTTP 0")) { try await client.stationList() }
}

@Test func cancellingBeforeRequestDoesNotReachTransport() async throws {
    let server = Server([.success(200)])
    let client = await server.client()
    let request = Task {
        withUnsafeCurrentTask { $0?.cancel() }
        return try await client.stationList()
    }
    await #expect(throws: CancellationError.self) { try await request.value }
    let (urls, _, _) = await server.snapshot()
    #expect(urls.isEmpty)
}

private final class UnavailableProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Test func cancellingDuringDefaultBackoffStopsTheRequest() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [UnavailableProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let (stream, continuation) = AsyncStream<Void>.makeStream()
    let client = IwlsClient(session: session, observeRequest: { _ in continuation.yield(()) })
    let task = Task { try await client.stationList() }
    for await _ in stream { break }
    task.cancel()
    await #expect(throws: CancellationError.self) { try await task.value }
    continuation.finish()
}


@Test func clientUsesTheRequestedGridForURLAndFiltering() async throws {
    let server = Server([.success(200)], body: """
        [{"eventDate":"1970-01-01T00:00:00Z","value":2},
         {"eventDate":"1970-01-01T00:01:00Z","value":3},
         {"eventDate":"1970-01-01T00:05:00Z","value":4}]
        """)
    let client = await server.client()
    let grid = try IwlsSampleGrid(sampleMinutes: 5)
    let samples = try await client.series("wlp", stationID: "resolved",
        chunk: ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 900)), grid: grid)
    #expect(samples == [ChsSample(t: 0, v: 2), ChsSample(t: 300000, v: 4)])
    let (urls, _, _) = await server.snapshot()
    let url = try #require(urls.first)
    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(components.queryItems?.first { $0.name == "resolution" }?.value == "FIVE_MINUTES")
}
