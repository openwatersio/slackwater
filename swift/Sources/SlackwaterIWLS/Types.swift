// SPDX-License-Identifier: MIT
import Foundation

public struct IwlsStation: Codable, Sendable {
    public struct Series: Codable, Sendable {
        public let code: String
        public init(code: String) { self.code = code }
    }
    public let id: String
    public let officialName: String
    public let latitude: Double
    public let longitude: Double
    public let timeSeries: [Series]

    public init(id: String, officialName: String, latitude: Double, longitude: Double, timeSeries: [Series]) {
        self.id = id
        self.officialName = officialName
        self.latitude = latitude
        self.longitude = longitude
        self.timeSeries = timeSeries
    }
}

public struct IwlsSample: Codable, Sendable {
    public let eventDate: String
    public let value: Double
}

public struct ChsSample: Codable, Equatable, Sendable {
    public let t: Double
    public let v: Double
    public init(t: Double, v: Double) { self.t = t; self.v = v }
}

public struct ChsChunk: Equatable, Hashable, Sendable {
    public let start: Date
    public let end: Date
    public init(start: Date, end: Date) { self.start = start; self.end = end }
    public var isCacheable: Bool {
        start.timeIntervalSince1970.isFinite && end.timeIntervalSince1970.isFinite &&
        end.timeIntervalSince(start) == 7 * 86400 &&
        start.timeIntervalSince1970.truncatingRemainder(dividingBy: 7 * 86400) == 0
    }
    /// Exact endpoints prove coverage without requiring every interior sample to be present.
    public func canCache(_ samples: [ChsSample], grid: IwlsSampleGrid = .fifteenMinutes) -> Bool {
        let startMs = start.timeIntervalSince1970 * 1000
        let endMs = end.timeIntervalSince1970 * 1000
        return isCacheable && samples.contains { $0.t == startMs } && samples.contains { $0.t == endMs } &&
            samples.allSatisfy {
                $0.t.isFinite && $0.v.isFinite && $0.t >= startMs && $0.t <= endMs &&
                $0.t.truncatingRemainder(dividingBy: Double(grid.sampleMinutes) * 60000) == 0
            }
    }
}

public enum IwlsError: Error, Equatable, LocalizedError {
    case permanent(String)
    case transient(String)

    public var errorDescription: String? {
        switch self {
        case .permanent(let reason), .transient(let reason): reason
        }
    }
}


public struct IwlsSampleGrid: Sendable, Equatable {
    public let sampleMinutes: Int
    public let resolution: String
    public static let fifteenMinutes = try! IwlsSampleGrid(sampleMinutes: 15)

    public init(sampleMinutes: Int) throws {
        switch sampleMinutes {
        case 1: resolution = "ONE_MINUTE"
        case 3: resolution = "THREE_MINUTES"
        case 5: resolution = "FIVE_MINUTES"
        case 15: resolution = "FIFTEEN_MINUTES"
        case 60: resolution = "SIXTY_MINUTES"
        default: throw IwlsError.permanent("unsupported IWLS sample minutes: \(sampleMinutes)")
        }
        self.sampleMinutes = sampleMinutes
    }
}

public struct IwlsChunkCacheEntry: Codable, Sendable {
    public static let emptyLifetimeSeconds = 86400.0
    public let startMs: Double
    public let endMs: Double
    public let sampleMinutes: Int
    public let fetchedAtMs: Double
    public let samples: [ChsSample]

    public init?(chunk: ChsChunk, samples: [ChsSample], grid: IwlsSampleGrid = .fifteenMinutes,
                 fetchedAt: Date) {
        guard chunk.isCacheable, fetchedAt.timeIntervalSince1970.isFinite,
              samples.isEmpty || chunk.canCache(samples, grid: grid) else { return nil }
        startMs = chunk.start.timeIntervalSince1970 * 1000
        endMs = chunk.end.timeIntervalSince1970 * 1000
        sampleMinutes = grid.sampleMinutes
        fetchedAtMs = fetchedAt.timeIntervalSince1970 * 1000
        self.samples = samples
    }

    public func isReusable(for chunk: ChsChunk, grid: IwlsSampleGrid = .fifteenMinutes, now: Date) -> Bool {
        guard startMs == chunk.start.timeIntervalSince1970 * 1000,
              endMs == chunk.end.timeIntervalSince1970 * 1000,
              sampleMinutes == grid.sampleMinutes, chunk.isCacheable, fetchedAtMs.isFinite else { return false }
        if samples.isEmpty {
            let ageMs = now.timeIntervalSince1970 * 1000 - fetchedAtMs
            return ageMs >= 0 && ageMs < Self.emptyLifetimeSeconds * 1000
        }
        return chunk.canCache(samples, grid: grid)
    }
}
