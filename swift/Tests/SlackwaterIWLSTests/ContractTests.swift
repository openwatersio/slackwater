import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
import Testing
@testable import SlackwaterIWLS

private struct Fixture: Decodable {
    struct Resolution: Decodable {
        let name: String
        let latitude: Double
        let longitude: Double
        let series: String
        let stations: [IwlsStation]
        let expectedID: String?
    }
    struct Midnight: Decodable { let now: String; let timeZone: String; let expected: String }
    struct Plan: Decodable { let days: Double; let endSeconds: Double; let expected: [[Double]] }
    struct Decoding: Decodable { let raw: [IwlsSample]; let expected: [ChsSample]; let grid: [ChsSample] }
    struct Request: Decodable {
        let stationID: String; let series: String; let startSeconds: Double; let endSeconds: Double
        let path: String; let query: [String: String]
    }
    struct Retry: Decodable { let status: Int; let attempt: Int; let retryAfter: Double?; let delay: Double? }
    struct PathComponent: Decodable { let id: String; let encoded: String? }
    struct SampleGrid: Decodable {
        let minutes: Int; let resolution: String; let input: [ChsSample]; let expected: [ChsSample]
    }
    struct ChunkCache: Decodable {
        let name: String; let startMs: Double; let endMs: Double
        let sampleMinutes: Int; let storedSampleMinutes: Int
        let fetchedAtMs: Double; let nowMs: Double; let samples: [ChsSample]
        let canCache: Bool; let canCreate: Bool; let reusable: Bool
    }
    let sampleGrids: [SampleGrid]
    let unsupportedSampleMinutes: [Int]
    let chunkCache: [ChunkCache]
    let version: Int
    let resolution: [Resolution]
    let midnights: [Midnight]
    let plans: [Plan]
    let decoding: [Decoding]
    let request: Request
    let retries: [Retry]
    let pathComponents: [PathComponent]
    let boundaryResponses: [[IwlsSample]]
    let boundaryExpected: [ChsSample]
}

private func fixture() throws -> Fixture {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures/iwls-fetch.json")
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
}

@Test func resolvesByPositionAndSeries() throws {
    let f = try fixture()
    #expect(f.version == 2)
    for row in f.resolution {
        if let expected = row.expectedID {
            let station = try IwlsFetch.resolve(name: row.name, latitude: row.latitude,
                longitude: row.longitude, series: row.series, in: row.stations)
            #expect(station.id == expected)
        } else {
            #expect(throws: IwlsError.self) {
                try IwlsFetch.resolve(name: row.name, latitude: row.latitude,
                    longitude: row.longitude, series: row.series, in: row.stations)
            }
        }
    }
}

@Test func anchorsAtStationMidnightAcrossDST() throws {
    let iso = ISO8601DateFormatter()
    for row in try fixture().midnights {
        let now = try #require(iso.date(from: row.now))
        let tz = try #require(TimeZone(identifier: row.timeZone))
        #expect(IwlsFetch.localMidnight(now: now, timeZone: tz) == iso.date(from: row.expected))
    }
}

@Test func epochPlansHaveStableCacheIdentities() throws {
    for row in try fixture().plans {
        let plan = IwlsFetch.chunkPlan(days: row.days, end: Date(timeIntervalSince1970: row.endSeconds))
        #expect(plan.map { [$0.start.timeIntervalSince1970, $0.end.timeIntervalSince1970] } == row.expected)
    }
    let end = Date(timeIntervalSince1970: 1_785_000_000)
    let fast = IwlsFetch.chunkPlan(days: 60, end: end)
    let full = IwlsFetch.chunkPlan(days: 210, end: end)
    #expect(Array(full.prefix(fast.count)) == fast)
    let tomorrow = IwlsFetch.chunkPlan(days: 210, end: end.addingTimeInterval(86400))
    #expect(Set(full.filter(\.isCacheable)).intersection(tomorrow.filter(\.isCacheable)).count >= 28)
    let week = try #require(full.first { $0.isCacheable })
    #expect(week.canCache([ChsSample(t: week.start.timeIntervalSince1970 * 1000, v: 1),
                           ChsSample(t: week.end.timeIntervalSince1970 * 1000, v: 1)]))
    #expect(!week.canCache([]), "an empty week must be fetched again")
    let partial = ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 900))
    #expect(!partial.canCache([ChsSample(t: 0, v: 1)]))
}

@Test func decodingAndCachedSamplesKeepTheFitGrid() throws {
    for row in try fixture().decoding {
        let decoded = try IwlsFetch.decode(JSONEncoder().encode(row.raw))
        #expect(decoded == row.expected)
        #expect(IwlsFetch.onGrid(decoded) == row.grid)
        #expect(IwlsFetch.onGrid(row.expected) == row.grid)
    }
    #expect(throws: (any Error).self) { try IwlsFetch.decode(Data("{}".utf8)) }
    #expect(throws: (any Error).self) { try IwlsFetch.decode(Data("[{\"eventDate\":\"1970-01-01T00:00:00Z\"}]".utf8)) }
    let f = try fixture()
    let combined = try f.boundaryResponses.flatMap { try IwlsFetch.decode(JSONEncoder().encode($0)) }
    #expect(combined == f.boundaryExpected)
}

@Test func requestUsesResolvedIDAndFifteenMinuteResolution() throws {
    let row = try fixture().request
    let url = try IwlsFetch.dataURL(row.series, stationID: row.stationID,
        chunk: ChsChunk(start: Date(timeIntervalSince1970: row.startSeconds), end: Date(timeIntervalSince1970: row.endSeconds)))
    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(components.path == row.path)
    #expect(Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") }) == row.query)
}

@Test func encodesTheResolvedIDAsOnePathComponent() throws {
    let chunk = ChsChunk(start: Date(timeIntervalSince1970: 0), end: Date(timeIntervalSince1970: 900))
    for row in try fixture().pathComponents {
        guard let encoded = row.encoded else {
            // Dot segments are removed by URL resolution, escaped or not, so they are refused.
            #expect(throws: IwlsError.self, "\(row.id)") { try IwlsFetch.dataURL("wlp", stationID: row.id, chunk: chunk) }
            #expect(throws: IwlsError.self, "\(row.id)") { try IwlsFetch.metadataURL(stationID: row.id) }
            continue
        }
        let url = try IwlsFetch.dataURL("wlp", stationID: row.id, chunk: chunk)
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.percentEncodedPath == "/api/v1/stations/\(encoded)/data", "\(row.id)")
        let metadata = try #require(URLComponents(url: try IwlsFetch.metadataURL(stationID: row.id),
                                                  resolvingAgainstBaseURL: false))
        #expect(metadata.percentEncodedPath == "/api/v1/stations/\(encoded)/metadata", "\(row.id)")
        #expect(metadata.queryItems == nil, "\(row.id)")
    }
}

@Test func retriesObeyTheSharedContract() throws {
    for row in try fixture().retries {
        #expect(IwlsFetch.retryDelay(after: .success(row.status), attempt: row.attempt, retryAfter: row.retryAfter) == row.delay)
    }
    for code in [URLError.timedOut, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost,
                 .dnsLookupFailed, .notConnectedToInternet, .resourceUnavailable, .badServerResponse, .zeroByteResource] {
        #expect(IwlsFetch.retryDelay(after: .failure(URLError(code)), attempt: 1) == 2)
    }
    for code in [Int(ECONNABORTED), Int(ECONNRESET), Int(ETIMEDOUT)] {
        #expect(IwlsFetch.retryDelay(after: .failure(NSError(domain: NSPOSIXErrorDomain, code: code)), attempt: 1) == 2)
    }
    for error: any Error in [URLError(.cancelled), URLError(.secureConnectionFailed), URLError(.dataNotAllowed), CancellationError(), NSError(domain: "other", code: 53)] {
        #expect(IwlsFetch.retryDelay(after: .failure(error), attempt: 1) == nil)
    }
    // JSON cannot carry these, and `Double("nan")` and `Double("inf")` both parse a header.
    for header in [Double.nan, .infinity, -.infinity] {
        #expect(IwlsFetch.retryDelay(after: .success(429), attempt: 1, retryAfter: header) == 60)
        #expect(IwlsFetch.retryDelay(after: .success(503), attempt: 1, retryAfter: header) == 2)
    }
    #expect(IwlsFetch.terminalError(status: 404) == .permanent("HTTP 404"))
    #expect(IwlsFetch.terminalError(status: 429) == .transient("HTTP 429"))
    #expect(IwlsFetch.terminalError(status: 503) == .transient("HTTP 503"))
}

@Test func sampleGridsFollowSharedContract() throws {
    let f = try fixture()
    let chunk = ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 900))
    for row in f.sampleGrids {
        let grid = try IwlsSampleGrid(sampleMinutes: row.minutes)
        #expect(grid.sampleMinutes == row.minutes)
        #expect(grid.resolution == row.resolution)
        #expect(IwlsFetch.onGrid(row.input, grid: grid) == row.expected)
        let url = try IwlsFetch.dataURL("wlp", stationID: "station", chunk: chunk, grid: grid)
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.queryItems?.first { $0.name == "resolution" }?.value == row.resolution)
    }
    for minutes in f.unsupportedSampleMinutes {
        #expect(throws: IwlsError.self) { try IwlsSampleGrid(sampleMinutes: minutes) }
    }
    #expect(try IwlsSampleGrid(sampleMinutes: 15) == .fifteenMinutes)
}

@Test func chunkCacheFollowsSharedContract() throws {
    for row in try fixture().chunkCache {
        let chunk = ChsChunk(start: .init(timeIntervalSince1970: row.startMs / 1000),
                             end: .init(timeIntervalSince1970: row.endMs / 1000))
        let storedGrid = try IwlsSampleGrid(sampleMinutes: row.storedSampleMinutes)
        let grid = try IwlsSampleGrid(sampleMinutes: row.sampleMinutes)
        #expect(chunk.canCache(row.samples, grid: storedGrid) == row.canCache, "\(row.name)")
        let entry = IwlsChunkCacheEntry(chunk: chunk, samples: row.samples, grid: storedGrid,
                                         fetchedAt: .init(timeIntervalSince1970: row.fetchedAtMs / 1000))
        #expect((entry != nil) == row.canCreate, "\(row.name)")
        // Decode raw metadata too: a saved entry cannot promote an incomplete response.
        let raw = try JSONSerialization.data(withJSONObject: [
            "startMs": row.startMs, "endMs": row.endMs,
            "sampleMinutes": row.storedSampleMinutes, "fetchedAtMs": row.fetchedAtMs,
            "samples": row.samples.map { ["t": $0.t, "v": $0.v] }
        ])
        let decoded = try JSONDecoder().decode(IwlsChunkCacheEntry.self, from: raw)
        #expect(decoded.isReusable(for: chunk, grid: grid,
                                  now: .init(timeIntervalSince1970: row.nowMs / 1000)) == row.reusable, "\(row.name)")
        if let entry {
            #expect(entry.startMs == row.startMs)
            #expect(entry.endMs == row.endMs)
            #expect(entry.sampleMinutes == row.storedSampleMinutes)
            #expect(entry.fetchedAtMs == row.fetchedAtMs)
            #expect(entry.samples == row.samples)
            let roundTrip = try JSONDecoder().decode(IwlsChunkCacheEntry.self, from: JSONEncoder().encode(entry))
            #expect(roundTrip.isReusable(for: chunk, grid: grid,
                                        now: .init(timeIntervalSince1970: row.nowMs / 1000)) == row.reusable)
        }
    }
}

@Test func chunkCacheRejectsNonfiniteDataAndWrongWindows() throws {
    let chunk = ChsChunk(start: .init(timeIntervalSince1970: 0), end: .init(timeIntervalSince1970: 604800))
    let endpoints = [ChsSample(t: 0, v: 1), ChsSample(t: 604800000, v: 1)]
    let now = Date(timeIntervalSince1970: 1000000)
    for invalid in [ChsSample(t: .nan, v: 1), ChsSample(t: .infinity, v: 1),
                    ChsSample(t: 0, v: .nan), ChsSample(t: 0, v: .infinity)] {
        #expect(!chunk.canCache(endpoints + [invalid]))
        #expect(IwlsChunkCacheEntry(chunk: chunk, samples: endpoints + [invalid], fetchedAt: now) == nil)
    }
    let entry = try #require(IwlsChunkCacheEntry(chunk: chunk, samples: endpoints, fetchedAt: now))
    let shifted = ChsChunk(start: .init(timeIntervalSince1970: 604800), end: .init(timeIntervalSince1970: 1209600))
    #expect(!entry.isReusable(for: shifted, now: now))
    #expect(IwlsChunkCacheEntry.emptyLifetimeSeconds == 86400)
    #expect(IwlsChunkCacheEntry(chunk: chunk, samples: [], fetchedAt: .init(timeIntervalSince1970: .nan)) == nil)
}
