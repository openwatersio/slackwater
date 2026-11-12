// Slackwater — MIT. Constituent model: V₀ and node correction resolution.
// Faithful port of @slackwater/engine constituent value()/correction() logic and
// defineConstituents (src/constituents/definition.ts).
import Foundation

/// A constituent as data: its speed, astronomical argument and nodal correction.
/// Pass definitions to predict or fit lines the catalog doesn't have, or defines
/// differently. Same shape as `ConstituentDefinition` in `@slackwater/engine`.
public struct ConstituentDefinition: Sendable, Equatable {
    public let name: String
    /// Degrees per hour. It must match the rate of the argument the coefficients or members give.
    public let speed: Double
    /// Doodson numbers for τ, s, h, p, N′ and p′, then the multiple of 90°, in Schureman's
    /// convention (IHO's XDO with D₂ to D₆ less 5 and D₇ as 5 − D₇). Nil for a compound
    /// whose argument is the sum of its members' arguments.
    public let coefficients: [Int]?
    public let aliases: [String]
    /// Constituents whose nodal corrections combine into this one's. Empty for no
    /// correction, unless the name or an alias has its own correction formula.
    public let members: [Member]

    public struct Member: Sendable, Equatable {
        public let name: String
        public let factor: Double
        public init(name: String, factor: Double) { self.name = name; self.factor = factor }
    }

    public init(name: String, speed: Double, coefficients: [Int]?, aliases: [String] = [], members: [Member] = []) {
        self.name = name; self.speed = speed; self.coefficients = coefficients
        self.aliases = aliases; self.members = members
    }
}

/// Why a set of constituent definitions was rejected; each case carries the name at fault.
public enum ConstituentDefinitionError: Error, Equatable {
    /// A malformed field, a negative speed or one that doesn't match the argument, names that belong
    /// to two constituents, or a replacement for Z0, which carries datum offsets.
    case invalidDefinition(String)
    /// A name defined twice, or two definitions for one catalog entry.
    case duplicateConstituent(String)
    /// A member that names no constituent.
    case unknownConstituent(String)
    /// Members that form a cycle.
    case cyclicConstituent(String)
}

/// The constituent catalog: the bundled `catalog.json`, plus any caller definitions.
/// Members link to entries by index, so a definition that replaces an entry leaves
/// the catalog's own compounds on the entry they were built with.
struct Catalog: Sendable {
    struct Link: Sendable { let index: Int; let factor: Double }
    struct Entry: Sendable {
        let name: String
        let speed: Double
        let coefficients: [Int]?
        var members: [Link]
        /// Names whose correction formula applies: the name, then aliases and replaced entries' names.
        var formulaNames: [String]
    }

    private(set) var entries: [Entry]
    /// Name or alias → entry.
    private(set) var index: [String: Int]
    /// Degrees per hour of each Doodson argument, from the engine.
    let argumentRates: [Double]

    static let shared: Catalog = {
        let url = Bundle.module.url(forResource: "catalog", withExtension: "json")!
        // swiftlint:disable:next force_try
        let file = try! JSONDecoder().decode(File.self, from: Data(contentsOf: url))
        var index: [String: Int] = [:]
        for (i, c) in file.constituents.enumerated() { index[c.name] = i }
        let entries = file.constituents.map { c in
            Entry(name: c.name, speed: c.speed, coefficients: c.coefficients,
                  members: (c.members ?? []).map { Link(index: index[$0.name]!, factor: $0.factor) },
                  formulaNames: [c.name])
        }
        for (alias, canonical) in file.aliases { index[alias] = index[canonical]! }
        return Catalog(entries: entries, index: index, argumentRates: file.argumentRates)
    }()

    private struct File: Decodable {
        let constituents: [Generated]; let aliases: [String: String]; let argumentRates: [Double]
    }
    private struct Generated: Decodable {
        let name: String; let speed: Double; let coefficients: [Int]?; let members: [Member]?
        struct Member: Decodable { let name: String; let factor: Double }
    }

    /// The catalog plus `definitions`, checked the way the engine's `defineConstituents` checks them.
    func with(_ definitions: [ConstituentDefinition]) throws -> Catalog {
        var catalog = self
        var built = Set<Int>()
        // Stations add datum offsets and mean flows as a Z0 term, so Z0 must stay a constant.
        let offset = index["Z0"]
        for definition in definitions {
            try Self.validate(definition)
            var keys: [String] = []
            for key in [definition.name] + definition.aliases where !keys.contains(key) { keys.append(key) }
            var replaced = Set<Int>()
            for key in keys {
                guard let i = catalog.index[key] else { continue }
                if built.contains(i) { throw ConstituentDefinitionError.duplicateConstituent(key) }
                replaced.insert(i)
            }
            if replaced.count > 1 { throw ConstituentDefinitionError.invalidDefinition(definition.name) }
            if let offset, replaced.contains(offset) { throw ConstituentDefinitionError.invalidDefinition(definition.name) }
            let added = catalog.entries.count
            var formulaNames = keys
            for (key, i) in catalog.index.sorted(by: { $0.key < $1.key }) where replaced.contains(i) {
                catalog.index[key] = added
                if !formulaNames.contains(key) { formulaNames.append(key) }
            }
            for key in keys { catalog.index[key] = added }
            catalog.entries.append(Entry(name: definition.name, speed: definition.speed,
                                         coefficients: definition.coefficients, members: [],
                                         formulaNames: formulaNames))
            built.insert(added)
        }
        // Second pass, so members can name definitions later in the list.
        let first = entries.count
        for (offset, definition) in definitions.enumerated() {
            catalog.entries[first + offset].members = try definition.members.map {
                guard let i = catalog.index[$0.name] else { throw ConstituentDefinitionError.unknownConstituent($0.name) }
                return Link(index: i, factor: $0.factor)
            }
        }
        // v0 and correction recurse through members, so a cycle would never return.
        var done = Set<Int>()
        func visit(_ i: Int, _ path: inout Set<Int>) throws {
            if path.contains(i) { throw ConstituentDefinitionError.cyclicConstituent(catalog.entries[i].name) }
            if done.contains(i) { return }
            path.insert(i)
            for member in catalog.entries[i].members { try visit(member.index, &path) }
            path.remove(i)
            done.insert(i)
        }
        for i in first..<catalog.entries.count {
            var path = Set<Int>()
            try visit(i, &path)
        }
        // Prediction advances V₀ at `speed`, and extremes restart it each day, so they must agree.
        for i in first..<catalog.entries.count where !(abs(catalog.rate(i) - catalog.entries[i].speed) <= 1e-5) {
            throw ConstituentDefinitionError.invalidDefinition(catalog.entries[i].name)
        }
        return catalog
    }

    private static func validate(_ d: ConstituentDefinition) throws {
        // Extremes and slack search assume every line turns forward.
        let valid = !d.name.isEmpty && d.speed.isFinite && d.speed >= 0 && (d.coefficients.map { $0.count == 7 } ?? true) &&
            d.aliases.allSatisfy { !$0.isEmpty } && d.members.allSatisfy { $0.factor.isFinite }
        if !valid { throw ConstituentDefinitionError.invalidDefinition(d.name) }
    }

    /// Degrees per hour at which `v0` advances.
    private func rate(_ i: Int) -> Double {
        let e = entries[i]
        if let coefficients = e.coefficients {
            return zip(coefficients, argumentRates).reduce(0) { $0 + Double($1.0) * $1.1 }
        }
        if e.members.isEmpty { return .nan }
        return e.members.reduce(0) { $0 + $1.factor * rate($1.index) }
    }

    /// Resolve an alias to its canonical name (identity if unknown).
    func canonical(_ name: String) -> String { index[name].map { entries[$0].name } ?? name }

    func contains(_ name: String) -> Bool { index[name] != nil }
    func speed(_ name: String) -> Double? { index[name].map { entries[$0].speed } }

    /// Equilibrium argument V₀ (degrees) for a constituent at the given astro state.
    /// Uses Doodson coefficients when present, else Σ factor·V₀(member).
    func v0(_ name: String, _ a: Astro) -> Double {
        guard let i = index[name] else { return 0 }
        return v0(at: i, a)
    }

    private func v0(at i: Int, _ a: Astro) -> Double {
        let e = entries[i]
        if let coeffs = e.coefficients {
            // Doodson args: [T+h-s, s, h, p, -N, pp, 90]
            let args = [a.ThMinusS, a.s, a.h, a.p, -a.N, a.pp, 90]
            var sum = 0.0
            for j in 0..<7 { sum += Double(coeffs[j]) * args[j] }
            return sum
        }
        var sum = 0.0
        for m in e.members { sum += m.factor * v0(at: m.index, a) }
        return sum
    }

    /// Node correction (f, u°). IHO fundamental if the constituent has one, else
    /// combined from members: f = Π f_memberᵃᵇˢ⁽ᶠᵃᶜᵗᵒʳ⁾, u = Σ factor·u_member.
    func correction(_ name: String, _ a: Astro) -> (f: Double, u: Double) {
        guard let i = index[name] else { return ihoCorrection(name, a) ?? (1, 0) }
        return correction(at: i, a)
    }

    private func correction(at i: Int, _ a: Astro) -> (f: Double, u: Double) {
        let e = entries[i]
        for name in e.formulaNames {
            if let fundamental = ihoCorrection(name, a) { return fundamental }
        }
        var f = 1.0
        var u = 0.0
        for m in e.members {
            let c = correction(at: m.index, a)
            u += m.factor * c.u
            f *= pow(c.f, abs(m.factor))
        }
        return (f, u)
    }
}
