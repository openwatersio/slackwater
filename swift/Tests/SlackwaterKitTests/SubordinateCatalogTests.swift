import Foundation
import Testing
import SlackwaterKit

private struct SubBatch: Decodable {
    let stations: [Station]

    struct Station: Decodable {
        let id: String
        let events: [Event]
    }

    struct Event: Decodable {
        let time: String
        let speed: Double
        let kind: String
    }
}

private func nearestSameKind(_ events: [CurrentEvent], _ kind: CurrentEventKind, to time: Date) -> CurrentEvent? {
    events.filter { $0.kind == kind }.min {
        abs($0.time.timeIntervalSince1970 - time.timeIntervalSince1970) < abs($1.time.timeIntervalSince1970 - time.timeIntervalSince1970)
    }
}

@Test func subordinateBatchMatchesNOAA() throws {
    let batch: SubBatch = try loadFixture("currents-golden-sub-batch", as: SubBatch.self)
    let catalog = CurrentCatalog.shared

    var worstTime = 0.0, worstSpeed = 0.0, stationsChecked = 0
    for station in batch.stations {
        guard !station.events.isEmpty, let current = catalog.station(station.id) else { continue }
        if case .harmonic = current { Issue.record("\(station.id) is not subordinate"); continue }
        let times = station.events.map { parseISO($0.time) }
        let computed = current.events(from: times.min()!.addingTimeInterval(-3600), to: times.max()!.addingTimeInterval(3600))
        var maxTime = 0.0, maxSpeed = 0.0, checked = 0
        for event in station.events where event.kind != "slack" {
            let time = parseISO(event.time)
            let kind: CurrentEventKind = event.kind == "maxFlood" ? .maxFlood : .maxEbb
            let matched = try #require(nearestSameKind(computed, kind, to: time), "\(station.id): no computed \(event.kind) near \(event.time)")
            let timeError = abs(matched.time.timeIntervalSince1970 - time.timeIntervalSince1970) / 60
            let speedError = abs(abs(matched.speed) - abs(event.speed))
            maxTime = max(maxTime, timeError); maxSpeed = max(maxSpeed, speedError); checked += 1
            #expect(timeError < 30, "\(station.id) \(event.kind) at \(event.time): time off \(timeError) min")
            #expect(speedError < 0.4, "\(station.id) \(event.kind) at \(event.time): speed \(matched.speed) vs \(event.speed)")
        }
        #expect(checked > 0)
        worstTime = max(worstTime, maxTime); worstSpeed = max(worstSpeed, maxSpeed); stationsChecked += 1
        print("  \(station.id): \(checked) max events, \(String(format: "%.1f", maxTime)) min / \(String(format: "%.3f", maxSpeed)) kn")
    }
    #expect(stationsChecked >= 8, "expected the full batch; checked \(stationsChecked)")
    print("Subordinate batch vs NOAA — \(stationsChecked) stations, worst \(String(format: "%.1f", worstTime)) min / \(String(format: "%.3f", worstSpeed)) kn")
}

/// Review finding on #8: an 8 h reference search and a 24 h one disagreed on
/// events — the extrema filter then skipped a window holding two or fewer results —
/// so `speeds` and `speed(at:along:)` over caller-held events gave ACT8791
/// −0.18 vs −0.40 kn at the same instant. Extraction is now per UTC day, so any
/// range's list is a concatenation of per-day lists, and the two agree for
/// every bundled subordinate.
@Test func subordinateCurveIsWindowInvariant() throws {
    let catalog = CurrentCatalog.shared
    let t = parseISO("2026-03-07T06:00:00Z")
    var checked = 0, worst = 0.0, worstId = ""
    for id in catalog.ids() {
        guard case .subordinate(let sub)? = catalog.station(id) else { continue }
        let held = sub.reference.eventsByDay(from: t.addingTimeInterval(-24 * 3600), to: t.addingTimeInterval(24 * 3600))
        let viaHeld = SubordinateStation.speed(at: t, along: sub.reduce(held))
        let viaSearch = sub.speeds(from: t, to: t.addingTimeInterval(1), step: 1).first!.speed
        let err = abs(viaHeld - viaSearch)
        if err > worst { worst = err; worstId = id }
        checked += 1
    }
    print("Subordinate curve invariance — \(checked) stations, worst \(String(format: "%.4f", worst)) kn at \(worstId)")
    #expect(checked > 100)
    #expect(worst < 1e-3, "\(worstId) differs by \(worst) kn between a held list and the search")

    // The per-day lists themselves: a day's events do not depend on the range asked for.
    guard case .subordinate(let sub)? = catalog.station("ACT8791") else { return }
    let day = parseISO("2026-03-07T00:00:00Z")
    let narrow = sub.reference.eventsByDay(from: day, to: day.addingTimeInterval(86_400 - 1))
    let wide = sub.reference.eventsByDay(from: day.addingTimeInterval(-5 * 86_400), to: day.addingTimeInterval(5 * 86_400))
        .filter { $0.time >= day && $0.time < day.addingTimeInterval(86_400) }
    #expect(narrow.count == wide.count)
    for (a, b) in zip(narrow, wide) { #expect(a.time == b.time && a.speed == b.speed) }
}
