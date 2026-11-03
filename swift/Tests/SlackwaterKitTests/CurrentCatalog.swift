// Slackwater — MIT. Test-only catalog over a sampled NOAA CO-OPS current bundle.
//
// The engine ships no station data: a catalog is the consumer's job, and the NOAA
// bundle belongs with the extractor in openwatersio/noaa-current-stations. What
// remains here is the loader the subordinate tests need to drive many stations at
// once, reading `currents-sample.json`.
import Foundation
import SlackwaterKit

enum AnyCurrentStation: Sendable {
    case harmonic(CurrentStation)
    case subordinate(SubordinateStation)
    func events(from: Date, to: Date) -> [CurrentEvent] {
        switch self {
        case .harmonic(let s): return s.events(from: from, to: to)
        case .subordinate(let s): return s.events(from: from, to: to)
        }
    }
}

struct CurrentCatalog: Sendable {
    private let stations: [String: StationRecord]

    static let shared = CurrentCatalog()

    private struct StationRecord: Decodable, Sendable {
        let id: String; let name: String; let type: String
        let floodDirection: Double?; let ebbDirection: Double?
        let offset: Double?
        let constituents: [Con]?
        let reference: String?
        let slackBeforeFloodOffset: Double?; let slackBeforeEbbOffset: Double?
        let floodTimeOffset: Double?; let ebbTimeOffset: Double?
        let floodSpeedRatio: Double?; let ebbSpeedRatio: Double?
        struct Con: Decodable, Sendable { let name: String; let amplitude: Double; let phase: Double }
    }
    private struct File: Decodable { let stations: [StationRecord] }

    private init() {
        guard let data = try? Data(contentsOf: fixtureURL("currents-sample")),
              let cat = try? CurrentCatalog(data: data) else {
            // ponytail: empty catalog if the fixture is missing — never crash.
            stations = [:]
            return
        }
        stations = cat.stations
    }

    init(data: Data) throws {
        let decoded = try JSONDecoder().decode(File.self, from: data)
        stations = Dictionary(decoded.stations.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    func ids() -> [String] { Array(stations.keys) }

    private func currentStation(_ r: StationRecord) -> CurrentStation {
        CurrentStation(
            constituents: (r.constituents ?? []).map {
                HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
            },
            floodDirection: r.floodDirection, ebbDirection: r.ebbDirection,
            offset: r.offset ?? 0)
    }

    func station(_ id: String) -> AnyCurrentStation? {
        guard let r = stations[id] else { return nil }
        if r.type == "harmonic" { return .harmonic(currentStation(r)) }
        guard let refId = r.reference, let ref = stations[refId], ref.type == "harmonic" else { return nil }
        return .subordinate(SubordinateStation(
            reference: currentStation(ref),
            slackBeforeFloodOffset: r.slackBeforeFloodOffset ?? 0, slackBeforeEbbOffset: r.slackBeforeEbbOffset ?? 0,
            floodTimeOffset: r.floodTimeOffset ?? 0, ebbTimeOffset: r.ebbTimeOffset ?? 0,
            floodSpeedRatio: r.floodSpeedRatio ?? 1, ebbSpeedRatio: r.ebbSpeedRatio ?? 1,
            floodDirection: r.floodDirection, ebbDirection: r.ebbDirection))
    }
}
