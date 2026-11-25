// Slackwater — MIT. Foreman's nodal corrections, as t_tide and UTide apply them.
// Port of @slackwater/engine src/node-corrections/foreman.ts. The tables are in catalog.json,
// from UTide (see LICENSE).
import Foundation

private let d2r = Double.pi / 180
private let r2d = 180 / Double.pi

/// The nodal correction formulas a station predicts with.
public enum NodeCorrections: Sendable, Equatable {
    /// IHO's, the default.
    case iho
    /// Foreman's satellite corrections, as t_tide and UTide apply them, for constants fitted that
    /// way, at the site's latitude in degrees north. The catalog's Sa, S1 and OQ2 are other lines
    /// than t_tide's by those names, so a station that lists them is refused.
    case foreman(latitude: Double)
}

/// Why a station's nodal corrections were rejected.
public enum NodeCorrectionsError: Error, Equatable {
    /// A latitude that isn't a number from -90 to 90.
    case invalidLatitude
    /// A catalog line t_tide knows by another name, and the catalog's name for t_tide's line.
    case notForemanLine(String, line: String)
}

/// Foreman's tables as catalog.json carries them.
struct ForemanTable: Decodable, Sendable {
    /// Each main line's satellites: changes in p, N and p′, phase in cycles, amplitude ratio, latitude factor kind.
    let satellites: [String: [[Double]]]
    /// Shallow-water lines as products of main lines, each with its power.
    let products: [String: [Member]]
    /// The catalog lines t_tide fits under Foreman's names, where they differ from the catalog's.
    let lines: [String: String]

    struct Member: Decodable, Sendable {
        let name: String
        let power: Double
        init(from decoder: Decoder) throws {
            var pair = try decoder.unkeyedContainer()
            name = try pair.decode(String.self)
            power = try pair.decode(Double.self)
        }
    }
}

/// Foreman's corrections at a latitude: each main line's satellites summed, two of them scaled by
/// the latitude, and shallow-water lines as products of main lines.
struct ForemanCorrections: Sendable {
    let table: ForemanTable
    private let factors: [Double]

    init(latitude: Double, table: ForemanTable) throws {
        guard abs(latitude) <= 90 else { throw NodeCorrectionsError.invalidLatitude }
        // t_tide holds the latitude 5° from the equator, where the first factor grows without bound.
        let s = sin(d2r * (abs(latitude) < 5 ? (latitude < 0 ? -5 : 5) : latitude))
        self.table = table
        factors = [1, 0.36309 * (1 - 5 * s * s) / s, 2.59808 * s]
    }

    /// Lines the catalog names one way and t_tide another: the catalog's M1 is t_tide's NO1.
    private static let aliases = ["M1": "NO1", "H1": "alpha2", "H2": "M(KS)2"]

    /// f and u for a line Foreman gives, or nil. `perigeeTurns` is as in `ihoCorrection`.
    func correction(_ name: String, _ a: Astro, perigeeTurns: Double) -> (f: Double, u: Double)? {
        let line = Self.aliases[name] ?? name
        if let satellites = table.satellites[line] {
            let c = main(satellites, a)
            // Foreman's NO1 argument holds one turn of p, as the catalog's M1 does.
            guard line == "NO1" else { return c }
            return (c.f, wrapDegrees(c.u - (perigeeTurns - 1) * a.p))
        }
        guard let members = table.products[name] else { return nil }
        var f = 1.0
        var u = 0.0
        for m in members {
            let c = main(table.satellites[m.name]!, a)
            f *= pow(c.f, abs(m.power))
            u += m.power * c.u
        }
        return (f, u)
    }

    private func main(_ satellites: [[Double]], _ a: Astro) -> (f: Double, u: Double) {
        var re = 1.0
        var im = 0.0
        for s in satellites {
            let angle = d2r * (s[0] * a.p + s[1] * a.N + s[2] * a.pp + 360 * s[3])
            let r = s[4] * factors[Int(s[5])]
            re += r * cos(angle)
            im += r * sin(angle)
        }
        return ((re * re + im * im).squareRoot(), r2d * atan2(im, re))
    }
}
