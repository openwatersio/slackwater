// SPDX-License-Identifier: MIT
// Adapted from https://github.com/openwatersio/slackwater-ios/blob/f6750e9/Slackwater/IwlsClient.swift; relicensed by the copyright holder.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Admits request starts one at a time, at least the interval apart. The gap runs from when the
/// previous request was actually admitted, so a stalled executor cannot release a burst, and a
/// waiter cancelled before its turn takes no slot.
public actor IwlsPacer {
    private let interval: Duration
    // Monotonic, so a wall-clock step back cannot stall every client in the process.
    private var last: ContinuousClock.Instant?
    private var admitting = false
    private var queue: [(id: UInt64, turn: CheckedContinuation<Void, any Error>)] = []
    private var nextID: UInt64 = 0

    public init(interval: TimeInterval = 2.5) { self.interval = .seconds(interval) }

    public func wait() async throws {
        try Task.checkCancellation()
        if admitting { try await takeTurn() } else { admitting = true }
        defer { passTurn() }
        if let last { try await Task.sleep(until: last + interval, clock: .continuous) }
        last = .now
    }

    private func takeTurn() async throws {
        let id = nextID
        nextID += 1
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (turn: CheckedContinuation<Void, any Error>) in
                enqueue(id, turn)
            }
        } onCancel: {
            Task { await self.leave(id) }
        }
    }

    private func enqueue(_ id: UInt64, _ turn: CheckedContinuation<Void, any Error>) {
        if Task.isCancelled { turn.resume(throwing: CancellationError()) } else { queue.append((id: id, turn: turn)) }
    }

    // A queued waiter that is cancelled leaves at once, without waiting for its turn.
    private func leave(_ id: UInt64) {
        guard let index = queue.firstIndex(where: { $0.id == id }) else { return }
        queue.remove(at: index).turn.resume(throwing: CancellationError())
    }

    private func passTurn() {
        if queue.isEmpty { admitting = false } else { queue.removeFirst().turn.resume() }
    }
}

public struct IwlsClient: Sendable {
    public static let base = "https://api-iwls.dfo-mpo.gc.ca/api/v1"
    public static let pacer = IwlsPacer()
    private let transport: @Sendable (URL) async throws -> (Data, URLResponse)
    private let pause: @Sendable (Double) async throws -> Void
    let requestPacer: IwlsPacer
    private let chunkCache: IwlsChunkCache?
    private let beforeRequest: @Sendable () throws -> Void
    private let observeRequest: @Sendable (TimeInterval) async -> Void

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
#if !canImport(FoundationNetworking)
        config.waitsForConnectivity = true
#endif
        // An unavailable path must eventually release the application's download queue.
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config)
    }()

    public init(session: URLSession? = nil, chunkCache: IwlsChunkCache? = nil,
                beforeRequest: @escaping @Sendable () throws -> Void = {},
                observeRequest: @escaping @Sendable (TimeInterval) async -> Void = { _ in }) {
        let session = session ?? Self.session
        self.init(transport: { try await session.data(from: $0) },
                  pause: { try await Task.sleep(for: .seconds($0)) },
                  pacer: Self.pacer, chunkCache: chunkCache, beforeRequest: beforeRequest, observeRequest: observeRequest)
    }

    init(transport: @escaping @Sendable (URL) async throws -> (Data, URLResponse),
         pause: @escaping @Sendable (Double) async throws -> Void,
         pacer: IwlsPacer, chunkCache: IwlsChunkCache? = nil,
         beforeRequest: @escaping @Sendable () throws -> Void = {}, observeRequest: @escaping @Sendable (TimeInterval) async -> Void) {
        self.chunkCache = chunkCache
        self.beforeRequest = beforeRequest
        self.transport = transport
        self.pause = pause
        self.requestPacer = pacer
        self.observeRequest = observeRequest
    }

    public func stationList() async throws -> [IwlsStation] {
        try JSONDecoder().decode([IwlsStation].self, from: await get(URL(string: Self.base + "/stations")!))
    }

    public struct Metadata: Decodable, Sendable {
        public let floodDirection: Double?
        public let ebbDirection: Double?
        public init(floodDirection: Double?, ebbDirection: Double?) {
            self.floodDirection = floodDirection; self.ebbDirection = ebbDirection
        }
    }

    public func metadata(stationID: String) async throws -> Metadata {
        try JSONDecoder().decode(Metadata.self, from: await get(IwlsFetch.metadataURL(stationID: stationID)))
    }

    public func series(_ code: String, stationID: String, chunk: ChsChunk,
                       grid: IwlsSampleGrid = .fifteenMinutes, cache: Bool = true,
                       cacheEmpty: Bool = true) async throws -> [ChsSample] {
        let url = try IwlsFetch.dataURL(code, stationID: stationID, chunk: chunk, grid: grid)
        if cache, let chunkCache {
            return try await chunkCache.samples(code, stationID: stationID, chunk: chunk, grid: grid, cacheEmpty: cacheEmpty) {
                try IwlsFetch.decode(await get(url))
            }
        }
        return try IwlsFetch.onGrid(IwlsFetch.decode(await get(url)), grid: grid)
    }

    private func get(_ url: URL) async throws -> Data {
        try Task.checkCancellation()
        var attempt = 0
        while true {
            try Task.checkCancellation()
            try beforeRequest()
            attempt += 1
            let began = ContinuousClock.now
            try await requestPacer.wait()
            try Task.checkCancellation()
            // A policy refusal is terminal, even when it uses a normally transient transport error.
            try beforeRequest()
            let result: Result<(Data, URLResponse), any Error>
            do {
                result = .success(try await transport(url))
            } catch {
                result = .failure(error)
            }
            let elapsed = (ContinuousClock.now - began).components
            await observeRequest(Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18)
            let outcome: Result<Int, any Error>
            let retryAfter: Double?
            switch result {
            case .success(let (data, response)):
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 0
                if status == 200, !data.isEmpty { return data }
                if status == 200 {
                    // An empty 200 is the contract's empty response: transient, like zeroByteResource.
                    outcome = .failure(URLError(.zeroByteResource))
                    retryAfter = nil
                } else {
                    outcome = .success(status)
                    retryAfter = http?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
                }
            case .failure(let error):
                outcome = .failure(error)
                retryAfter = nil
            }
            guard let delay = IwlsFetch.retryDelay(after: outcome, attempt: attempt, retryAfter: retryAfter) else {
                switch outcome {
                case .success(let status): throw IwlsFetch.terminalError(status: status)
                case .failure(let error): throw error
                }
            }
            try await pause(delay)
        }
    }
}
