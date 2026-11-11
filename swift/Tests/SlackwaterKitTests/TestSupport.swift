import Foundation
import SlackwaterKit

func fixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures")
        .appendingPathComponent(name)
        .appendingPathExtension("json")
}

func loadFixture<T: Decodable>(_ name: String, as: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(contentsOf: fixtureURL(name)))
}

func parseISO(_ s: String) -> Date {
    let withFrac = ISO8601DateFormatter()
    withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = withFrac.date(from: s) { return d }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: s)!
}

/// Circular degree difference — avoids false failures at the 0/360 wrap.
func angularDiff(_ a: Double, _ b: Double) -> Double {
    let d = abs(a - b).truncatingRemainder(dividingBy: 360)
    return min(d, 360 - d)
}

func currentEventKind(_ name: String) throws -> CurrentEventKind {
    switch name {
    case "slack": return .slack
    case "maxFlood": return .maxFlood
    case "maxEbb": return .maxEbb
    case "minFlood": return .minFlood
    case "minEbb": return .minEbb
    default: throw NSError(domain: "CurrentEventKind", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown current kind: \(name)"])
    }
}
