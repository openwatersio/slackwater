// SPDX-License-Identifier: MIT
// Adapted from https://github.com/openwatersio/slackwater-ios/blob/f6750e9/Slackwater/IwlsClient.swift and ChsFitService.swift; relicensed by the copyright holder.
import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum IwlsFetch {
    public static let resolveToleranceKm = 3.0

    public static func localMidnight(now: Date, timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.startOfDay(for: now)
    }

    public static func chunkPlan(days: Double, end: Date) -> [ChsChunk] {
        precondition(days.isFinite && days > 0, "chunkPlan needs a positive, finite duration")
        let week = 7 * 86_400.0
        let endS = end.timeIntervalSince1970
        var out: [ChsChunk] = []
        var t = (((endS - days * 86_400) / week).rounded(.down)) * week
        while t < endS {
            out.append(ChsChunk(start: Date(timeIntervalSince1970: t),
                                end: Date(timeIntervalSince1970: min(t + week, endS))))
            t += week
        }
        return out.reversed()
    }

    public static func resolve(name: String, latitude: Double, longitude: Double,
                                    series: String, in list: [IwlsStation]) throws -> IwlsStation {
        let candidates = list.filter { st in st.timeSeries.contains { $0.code == series } }
        guard let best = candidates.min(by: {
            distanceKm(latitude, longitude, $0.latitude, $0.longitude) <
            distanceKm(latitude, longitude, $1.latitude, $1.longitude)
        }) else { throw IwlsError.permanent("no IWLS station serves \(series)") }
        let km = distanceKm(latitude, longitude, best.latitude, best.longitude)
        guard km <= resolveToleranceKm else {
            throw IwlsError.permanent("\(name): nearest \(series) station \(best.officialName) is \(String(format: "%.1f", km)) km away")
        }
        return best
    }
    public static let maxAttempts = 4

    public static func isTransient(_ error: Error) -> Bool {
        if let url = error as? URLError { return transientCodes.contains(url.code) }
        let ns = error as NSError
        return ns.domain == NSPOSIXErrorDomain && [Int(ECONNABORTED), Int(ECONNRESET), Int(ETIMEDOUT)].contains(ns.code)
    }

    private static let transientCodes: Set<URLError.Code> = [
        .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
        .networkConnectionLost, .notConnectedToInternet, .resourceUnavailable,
        .badServerResponse, .zeroByteResource,
    ]

    /// The longest `Retry-After` the client waits, so one header cannot hold the queue for
    /// hours. A longer ask waits this long instead: failing at once would let the app's queue
    /// send every other job into the window the server is limiting.
    public static let maxRetryAfter = 600.0

    public static func retryDelay(after outcome: Result<Int, Error>, attempt: Int,
                           retryAfter: Double? = nil) -> Double? {
        guard attempt < maxAttempts else { return nil }
        let backoff = pow(2, Double(attempt))
        // `max` passes NaN through, and sleeping for NaN or infinity traps.
        let asked = retryAfter.flatMap { $0.isFinite && $0 >= 0 ? min($0, maxRetryAfter) : nil } ?? 0
        switch outcome {
        case .failure(let error):
            return isTransient(error) ? backoff : nil
        case .success(429):
            return max(asked, 60)
        case .success(let status):
            guard (500...599).contains(status), ![501, 505, 511].contains(status) else { return nil }
            return max(asked, backoff)
        }
    }

    public static func terminalError(status code: Int) -> IwlsError {
        (400...499).contains(code) && code != 429
            ? .permanent("HTTP \(code)") : .transient("HTTP \(code)")
    }

    public static func decode(_ data: Data) throws -> [ChsSample] {
        let iso = ISO8601DateFormatter()
        let raw = try JSONDecoder().decode([IwlsSample].self, from: data)
        var out: [ChsSample] = []
        for s in raw {
            guard let date = iso.date(from: s.eventDate) else { continue }
            let ms = date.timeIntervalSince1970 * 1000
            if out.last?.t != ms { out.append(ChsSample(t: ms, v: s.value)) }
        }
        return out
    }

    public static func onGrid(_ samples: [ChsSample], grid: IwlsSampleGrid = .fifteenMinutes) -> [ChsSample] {
        samples.filter { $0.t.truncatingRemainder(dividingBy: Double(grid.sampleMinutes) * 60_000) == 0 }
    }

    public static let fitSeries: Set<String> = ["wlp", "wcsp1", "wcdp1"]

    public static func dataURL(_ code: String, stationID: String, chunk: ChsChunk, grid: IwlsSampleGrid = .fifteenMinutes) throws -> URL {
        // Only the fit series: grid filtering would silently drop event series like wlp-hilo.
        guard fitSeries.contains(code),
              chunk.start.timeIntervalSince1970.isFinite, chunk.end.timeIntervalSince1970.isFinite,
              chunk.end >= chunk.start, chunk.end.timeIntervalSince(chunk.start) <= 7 * 86400 else {
            throw IwlsError.permanent("invalid IWLS series request")
        }
        var url = try stationURL(stationID, "data")
        let iso = ISO8601DateFormatter()
        url.queryItems = [
            URLQueryItem(name: "time-series-code", value: code),
            URLQueryItem(name: "from", value: iso.string(from: chunk.start)),
            URLQueryItem(name: "to", value: iso.string(from: chunk.end)),
            URLQueryItem(name: "resolution", value: grid.resolution)
        ]
        return url.url!
    }

    public static func metadataURL(stationID: String) throws -> URL {
        try stationURL(stationID, "metadata").url!
    }

    // RFC 3986 pchar, spelled out: Linux Foundation's urlPathAllowed escapes ";".
    private static let pathKept = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@")

    private static func stationURL(_ stationID: String, _ resource: String) throws -> URLComponents {
        // "." and ".." are dot segments: URL resolution removes them, escaped or not.
        guard !stationID.isEmpty, stationID != ".", stationID != ".." else {
            throw IwlsError.permanent("invalid IWLS station id")
        }
        var url = URLComponents(string: IwlsClient.base)!
        // Encode the ID as one path component, even when the caller supplies reserved characters.
        let id = stationID.addingPercentEncoding(withAllowedCharacters: pathKept)!
        url.percentEncodedPath += "/stations/\(id)/\(resource)"
        return url
    }
}

private func distanceKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
    let dp = p2 - p1, dl = (lon2 - lon1) * .pi / 180
    let h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
    return 2 * 6371.0088 * asin(min(1, sqrt(h)))
}
