// Slackwater — MIT. Constituent model: V₀ and node correction resolution.
// Faithful port of @slackwater/engine constituent value()/correction() logic
// (src/constituents/definition.ts). Members are pre-resolved in the catalog.
import Foundation

/// One catalog constituent, generated from the engine's catalog with `members`
/// resolved by name at codegen time.
struct CatalogEntry: Decodable, Sendable {
    let name: String
    let speed: Double
    let coefficients: [Int]?
    let members: [Member]?

    struct Member: Decodable, Sendable {
        let name: String
        let factor: Double
    }
}

/// The constituent catalog, loaded once from the bundled `catalog.json`.
struct Catalog: Sendable {
    let byName: [String: CatalogEntry]
    /// Alias → canonical name (e.g. NOAA "NU2" → "nu2"), so real station data resolves.
    let aliases: [String: String]

    static let shared: Catalog = {
        let url = Bundle.module.url(forResource: "catalog", withExtension: "json")!
        // swiftlint:disable:next force_try
        let decoded = try! JSONDecoder().decode(File.self, from: Data(contentsOf: url))
        return Catalog(byName: Dictionary(uniqueKeysWithValues: decoded.constituents.map { ($0.name, $0) }),
                       aliases: decoded.aliases)
    }()

    private struct File: Decodable { let constituents: [CatalogEntry]; let aliases: [String: String] }

    /// Resolve an alias to its canonical name (identity if already canonical).
    func canonical(_ name: String) -> String { aliases[name] ?? name }

    func entry(_ name: String) -> CatalogEntry? { byName[canonical(name)] }
    func speed(_ name: String) -> Double? { byName[canonical(name)]?.speed }

    /// Equilibrium argument V₀ (degrees) for a constituent at the given astro state.
    /// Uses Doodson coefficients when present, else Σ factor·V₀(member).
    func v0(_ name: String, _ a: Astro) -> Double {
        guard let e = byName[canonical(name)] else { return 0 }
        if let coeffs = e.coefficients {
            // Doodson args: [T+h-s, s, h, p, -N, pp, 90]
            let args = [a.ThMinusS, a.s, a.h, a.p, -a.N, a.pp, 90]
            var sum = 0.0
            for i in 0..<7 { sum += Double(coeffs[i]) * args[i] }
            return sum
        }
        var sum = 0.0
        for m in e.members ?? [] { sum += m.factor * v0(m.name, a) }
        return sum
    }

    /// Node correction (f, u°). IHO fundamental if the constituent has one, else
    /// combined from members: f = Π f_memberᵃᵇˢ⁽ᶠᵃᶜᵗᵒʳ⁾, u = Σ factor·u_member.
    func correction(_ name: String, _ a: Astro) -> (f: Double, u: Double) {
        let key = canonical(name)
        if let fundamental = ihoCorrection(key, a) { return fundamental }
        guard let e = byName[key] else { return (1, 0) }
        var f = 1.0
        var u = 0.0
        for m in e.members ?? [] {
            let c = correction(m.name, a)
            u += m.factor * c.u
            f *= pow(c.f, abs(m.factor))
        }
        return (f, u)
    }
}
