// SPDX-License-Identifier: MIT
// Adapted from https://github.com/openwatersio/slackwater-ios/blob/2b95948/Slackwater/IwlsClient.swift; relicensed by the copyright holder.
import Foundation

/// Persistent fit chunks with shared eligibility, expiry, migration, and in-process synchronization.
public final class IwlsChunkCache: Sendable {
    // Migration writes during a read, so cache transitions share a reentrant lock.
    private static let lock = NSRecursiveLock()
    public let directory: URL

    /// Use a dedicated cache directory; reset removes its complete contents.
    public init(directory: URL) { self.directory = directory }

    public func samples(_ code: String, stationID: String, chunk: ChsChunk,
                        grid: IwlsSampleGrid = .fifteenMinutes, cacheEmpty: Bool = true,
                        fetch: @Sendable () async throws -> [ChsSample]) async throws -> [ChsSample] {
        try Task.checkCancellation()
        _ = try IwlsFetch.dataURL(code, stationID: stationID, chunk: chunk, grid: grid)
        if let hit = load(stationID, code, chunk, grid: grid), cacheEmpty || !hit.isEmpty { return hit }
        let samples = IwlsFetch.onGrid(try await fetch(), grid: grid)
        try Task.checkCancellation()
        if cacheEmpty || !samples.isEmpty { save(samples, stationID, code, chunk, grid: grid) }
        // A concurrent request may have stored a complete week while this fetch returned empty or truncated.
        if let stored = load(stationID, code, chunk, grid: grid), !stored.isEmpty { return stored }
        return samples
    }

    public func reset() {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        try? FileManager.default.removeItem(at: directory)
    }

    private func component(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"))!
    }

    private func belongs(_ file: String, to stationID: String) -> Bool {
        for code in IwlsFetch.fitSeries {
            let prefix = "\(component(stationID))-\(code)-"
            guard file.hasPrefix(prefix), file.hasSuffix(".json") else { continue }
            let suffix = String(file.dropFirst(prefix.count).dropLast(5))
            if suffix.range(of: #"^-?[0-9]+(?:-[0-9]+m)?$"#, options: .regularExpression) != nil { return true }
        }
        return false
    }

    func legacyURL(_ stationID: String, _ code: String, _ chunk: ChsChunk) -> URL {
        directory.appendingPathComponent("\(component(stationID))-\(code)-\(Int(chunk.start.timeIntervalSince1970)).json")
    }

    func url(_ stationID: String, _ code: String, _ chunk: ChsChunk,
                    grid: IwlsSampleGrid = .fifteenMinutes) -> URL {
        directory.appendingPathComponent("\(component(stationID))-\(code)-\(Int(chunk.start.timeIntervalSince1970))-\(grid.sampleMinutes)m.json")
    }

    func emptyURL(_ stationID: String, _ code: String, _ chunk: ChsChunk,
                         grid: IwlsSampleGrid = .fifteenMinutes) -> URL {
        directory.appendingPathComponent("Empty", isDirectory: true)
            .appendingPathComponent(url(stationID, code, chunk, grid: grid).lastPathComponent)
    }

    func load(_ stationID: String, _ code: String, _ chunk: ChsChunk,
                     grid: IwlsSampleGrid = .fifteenMinutes, now: Date = .now) -> [ChsSample]? {
        guard chunk.isCacheable else { return nil }
        Self.lock.lock()
        defer { Self.lock.unlock() }
        if let samples = readEntry(url(stationID, code, chunk, grid: grid), chunk: chunk, grid: grid, now: now) {
            return samples
        }
        // An older build can write fresh samples during rollback. Reconcile those before a negative hit.
        if grid == .fifteenMinutes,
           let data = try? Data(contentsOf: legacyURL(stationID, code, chunk)),
           let raw = try? JSONDecoder().decode([ChsSample].self, from: data) {
            let samples = IwlsFetch.onGrid(raw, grid: grid)
            if chunk.canCache(samples, grid: grid) {
                // save removes the legacy file only after its replacement was written successfully.
                save(samples, stationID, code, chunk, grid: grid, fetchedAt: now)
                return samples
            }
        }
        return readEntry(emptyURL(stationID, code, chunk, grid: grid), chunk: chunk, grid: grid, now: now)
    }

    private func readEntry(_ file: URL, chunk: ChsChunk, grid: IwlsSampleGrid, now: Date) -> [ChsSample]? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        if let entry = try? JSONDecoder().decode(IwlsChunkCacheEntry.self, from: data),
           entry.isReusable(for: chunk, grid: grid, now: now) { return entry.samples }
        try? FileManager.default.removeItem(at: file)
        return nil
    }

    func save(_ samples: [ChsSample], _ stationID: String, _ code: String, _ chunk: ChsChunk,
                     grid: IwlsSampleGrid = .fifteenMinutes, fetchedAt: Date = .now) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        guard let entry = IwlsChunkCacheEntry(chunk: chunk, samples: samples, grid: grid, fetchedAt: fetchedAt) else { return }
        // A later empty response cannot invalidate complete immutable samples already on disk.
        if samples.isEmpty, let positive = load(stationID, code, chunk, grid: grid, now: fetchedAt), !positive.isEmpty { return }
        let positive = url(stationID, code, chunk, grid: grid)
        let negative = emptyURL(stationID, code, chunk, grid: grid)
        let file = samples.isEmpty ? negative : positive
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        var marked = directory
        var exclude = URLResourceValues()
        exclude.isExcludedFromBackup = true
        try? marked.setResourceValues(exclude)
        do {
            try JSONEncoder().encode(entry).write(to: file, options: .atomic)
            try? FileManager.default.removeItem(at: samples.isEmpty ? positive : negative)
            if grid == .fifteenMinutes { try? FileManager.default.removeItem(at: legacyURL(stationID, code, chunk)) }
        } catch { return }
    }

    // Keep recent empty responses through a successful fit so retrying cannot immediately re-query them.
    public func purge(_ stationID: String, includingEmpty: Bool = false, now: Date = .now) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for f in files where belongs(f, to: stationID) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(f))
        }
        let emptyDir = directory.appendingPathComponent("Empty", isDirectory: true)
        let emptyFiles = (try? FileManager.default.contentsOfDirectory(at: emptyDir, includingPropertiesForKeys: nil)) ?? []
        for file in emptyFiles where belongs(file.lastPathComponent, to: stationID) {
            if includingEmpty { try? FileManager.default.removeItem(at: file); continue }
            guard let data = try? Data(contentsOf: file),
                  let entry = try? JSONDecoder().decode(IwlsChunkCacheEntry.self, from: data),
                  let grid = try? IwlsSampleGrid(sampleMinutes: entry.sampleMinutes) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let chunk = ChsChunk(start: Date(timeIntervalSince1970: entry.startMs / 1000),
                                 end: Date(timeIntervalSince1970: entry.endMs / 1000))
            if !entry.isReusable(for: chunk, grid: grid, now: now) {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
}
