import Foundation
import Testing
@testable import SlackwaterKit

private struct ConstituentFixture: Decodable {
    let entries: [Entry]
    struct Entry: Decodable { let time: String; let constituents: [String: VFU] }
    struct VFU: Decodable { let v0: Double; let f: Double; let u: Double }
}

@Test func constituentV0AndCorrectionsMatchSlackwater() throws {
    let fixture = try loadFixture("constituents", as: ConstituentFixture.self)
    let catalog = Catalog.shared
    #expect(catalog.entries.count >= 300)
    for entry in fixture.entries {
        let a = astro(parseISO(entry.time))
        for (name, expected) in entry.constituents {
            #expect(angularDiff(catalog.v0(name, a), expected.v0) < 1e-6,
                    "\(name) V0 at \(entry.time): got \(catalog.v0(name, a)), want \(expected.v0)")
            let corr = catalog.correction(name, a)
            #expect(abs(corr.f - expected.f) < 1e-6, "\(name) f at \(entry.time): got \(corr.f), want \(expected.f)")
            #expect(angularDiff(corr.u, expected.u) < 1e-6, "\(name) u at \(entry.time): got \(corr.u), want \(expected.u)")
        }
    }
}
