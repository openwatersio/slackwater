import Foundation
import Testing
@testable import SlackwaterKit

private typealias JSON = [String: Any]

private func loadDefinitionsFixture() throws -> JSON {
    // swiftlint:disable:next force_cast
    try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL("constituent-definitions"))) as! JSON
}

/// Nil when a field doesn't fit the types, such as a null speed or a fractional coefficient.
private func definitions(_ entry: JSON) -> [ConstituentDefinition]? {
    var out: [ConstituentDefinition] = []
    for case let d as JSON in entry["definitions"] as? [Any] ?? [] {
        guard let name = d["name"] as? String, let speed = d["speed"] as? Double else { return nil }
        var coefficients: [Int]?
        if let values = d["coefficients"] as? [Double] {
            guard values.allSatisfy({ $0 == $0.rounded() }) else { return nil }
            coefficients = values.map { Int($0) }
        }
        let members = (d["members"] as? [[Any]] ?? []).map {
            ConstituentDefinition.Member(name: $0[0] as! String, factor: $0[1] as! Double) // swiftlint:disable:this force_cast
        }
        out.append(ConstituentDefinition(name: name, speed: speed, coefficients: coefficients,
                                         aliases: d["aliases"] as? [String] ?? [], members: members))
    }
    return out
}

private func constituents(_ entry: JSON) -> [HarmonicConstituent] {
    (entry["constituents"] as? [JSON] ?? []).map {
        HarmonicConstituent(name: $0["name"] as! String, amplitude: $0["amplitude"] as! Double, // swiftlint:disable:this force_cast
                            phase: $0["phase"] as! Double) // swiftlint:disable:this force_cast
    }
}

private func span(_ entry: JSON) -> (Date, Date, Double) {
    (parseISO(entry["start"] as! String), parseISO(entry["end"] as! String), entry["step"] as! Double) // swiftlint:disable:this force_cast
}

@Test func definitionsPredictLikeTheEngine() throws {
    let fixture = try loadDefinitionsFixture()
    for case let entry as JSON in fixture["predictions"] as! [Any] { // swiftlint:disable:this force_cast
        let name = entry["name"] as! String // swiftlint:disable:this force_cast
        let (start, end, step) = span(entry)
        let station = try Station(constituents: constituents(entry), definitions: definitions(entry)!)
        let heights = station.heights(from: start, to: end, step: step)
        let expected = entry["heights"] as! [Double] // swiftlint:disable:this force_cast
        #expect(heights.count == expected.count, "\(name)")
        for (got, want) in zip(heights, expected) {
            #expect(abs(got.height - want) < 1e-6, "\(name): got \(got.height), want \(want)")
        }
        let extremes = station.extremes(from: start, to: end)
        let wanted = entry["extremes"] as! [JSON] // swiftlint:disable:this force_cast
        #expect(extremes.count == wanted.count, "\(name) extremes")
        for (got, want) in zip(extremes, wanted) {
            #expect(got.kind == (want["high"] as! Bool ? .high : .low), "\(name) extreme kind") // swiftlint:disable:this force_cast
            #expect(abs(got.time.timeIntervalSince(parseISO(want["time"] as! String))) < 60, "\(name) extreme time") // swiftlint:disable:this force_cast
            #expect(abs(got.height - (want["level"] as! Double)) < 0.02, "\(name) extreme level") // swiftlint:disable:this force_cast
        }
    }
}

@Test func definitionsPredictCurrents() throws {
    let fixture = try loadDefinitionsFixture()
    let entry = (fixture["predictions"] as! [JSON])[0] // swiftlint:disable:this force_cast
    let (start, end, step) = span(entry)
    let speeds = try CurrentStation(constituents: constituents(entry), definitions: definitions(entry)!)
        .speeds(from: start, to: end, step: step)
    #expect(speeds.count == (entry["heights"] as! [Double]).count) // swiftlint:disable:this force_cast
    for (got, want) in zip(speeds, entry["heights"] as! [Double]) { // swiftlint:disable:this force_cast
        #expect(abs(got.speed - want) < 1e-6)
    }
}

#if canImport(Accelerate)
@Test func definitionsFitLikeTheEngine() throws {
    let fixture = try loadDefinitionsFixture()
    let entry = fixture["fit"] as! JSON // swiftlint:disable:this force_cast
    let samples = (entry["samples"] as! [JSON]).map { // swiftlint:disable:this force_cast
        HarmonicSample(time: parseISO($0["time"] as! String), value: $0["value"] as! Double) // swiftlint:disable:this force_cast
    }
    let result = try fit(samples: samples, constituents: entry["basis"] as! [String], // swiftlint:disable:this force_cast
                         definitions: definitions(entry)!)
    let expected = constituents(entry["expected"] as! JSON) // swiftlint:disable:this force_cast
    #expect(result.constituents.map(\.name) == expected.map(\.name))
    for (got, want) in zip(result.constituents, expected) {
        #expect(abs(got.amplitude - want.amplitude) < 1e-6, "\(want.name) amplitude")
        #expect(angularDiff(got.phase, want.phase) < 1e-3, "\(want.name) phase")
    }
}
#endif

@Test func definitionsRejectWhatTheEngineRejects() throws {
    let fixture = try loadDefinitionsFixture()
    for case let entry as JSON in fixture["errors"] as! [Any] { // swiftlint:disable:this force_cast
        let name = entry["name"] as! String // swiftlint:disable:this force_cast
        let code = entry["error"] as! String // swiftlint:disable:this force_cast
        guard let parsed = definitions(entry) else {
            #expect(code == "invalidDefinition", "\(name)")
            continue
        }
        do {
            _ = try Station(constituents: [], definitions: parsed)
            Issue.record("\(name): accepted")
        } catch let error as ConstituentDefinitionError {
            let got: String
            switch error {
            case .invalidDefinition: got = "invalidDefinition"
            case .duplicateConstituent: got = "duplicateConstituent"
            case .unknownConstituent: got = "unknownConstituent"
            case .cyclicConstituent: got = "cyclicConstituent"
            }
            #expect(got == code, "\(name)")
        } catch {
            Issue.record("\(name): \(error)")
        }
    }
}
