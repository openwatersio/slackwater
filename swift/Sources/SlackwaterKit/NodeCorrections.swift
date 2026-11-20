// Slackwater — MIT. Node corrections (IHO scheme).
// Faithful port of @slackwater/engine src/node-corrections/iho.ts — the default
// scheme the predictor uses. (Schureman is intentionally not ported: nothing uses it.)
// f is dimensionless; u is in degrees.
import Foundation

private let d2r = Double.pi / 180
private let r2d = 180 / Double.pi

/// To ±180°. For an argument that holds p, u then stays near zero and never wraps.
private func wrapDegrees(_ d: Double) -> Double { d - 360 * (d / 360 + 0.5).rounded(.down) }

/// Convert f·sinU / f·cosU form to (f, u°).
private func fromSinCos(_ fsinU: Double, _ fcosU: Double) -> (f: Double, u: Double) {
    (f: (fsinU * fsinU + fcosU * fcosU).squareRoot(), u: r2d * atan2(fsinU, fcosU))
}

private func corrMm(_ N: Double, _ p: Double) -> (Double, Double) {
    (1 - 0.1311 * cos(N) + 0.0538 * cos(2 * p) + 0.0205 * cos(2 * p - N), 0)
}
private func corrMf(_ N: Double) -> (Double, Double) {
    (1.084 + 0.415 * cos(N) + 0.039 * cos(2 * N),
     -23.7 * sin(N) + 2.7 * sin(2 * N) - 0.4 * sin(3 * N))
}
private func corrO1(_ N: Double) -> (Double, Double) {
    (1.0176 + 0.1871 * cos(N) - 0.0147 * cos(2 * N),
     10.8 * sin(N) - 1.34 * sin(2 * N) + 0.19 * sin(3 * N))
}
private func corrK1(_ N: Double) -> (Double, Double) {
    (1.006 + 0.115 * cos(N) - 0.0088 * cos(2 * N) + 6e-4 * cos(3 * N),
     -8.86 * sin(N) + 0.68 * sin(2 * N) - 0.07 * sin(3 * N))
}
private func corrJ1(_ N: Double) -> (Double, Double) {
    (1.1029 + 0.1676 * cos(N) - 0.017 * cos(2 * N) + 0.0016 * cos(3 * N),
     -12.94 * sin(N) + 1.34 * sin(2 * N) - 0.19 * sin(3 * N))
}
private func corrM2(_ N: Double) -> (Double, Double) {
    (1.0007 - 0.0373 * cos(N) + 2e-4 * cos(2 * N), -2.14 * sin(N))
}
private func corrK2(_ N: Double) -> (Double, Double) {
    (1.0246 + 0.2863 * cos(N) + 0.0083 * cos(2 * N) - 0.0015 * cos(3 * N),
     -17.74 * sin(N) + 0.68 * sin(2 * N) - 0.04 * sin(3 * N))
}
private func corrM3(_ N: Double) -> (Double, Double) {
    let m2 = corrM2(N)
    return (pow(m2.0.squareRoot(), 3), -3.21 * sin(N))
}
private func corrM1B(_ N: Double, _ p: Double) -> (Double, Double) {
    fromSinCos(2.783 * sin(2 * p) + 0.558 * sin(2 * p - N) + 0.184 * sin(N),
               1 + 2.783 * cos(2 * p) + 0.558 * cos(2 * p - N) + 0.184 * cos(N))
}
private func corrM1(_ N: Double, _ p: Double) -> (Double, Double) {
    fromSinCos(sin(p) + 0.2 * sin(p - N), 2 * (cos(p) + 0.2 * cos(p - N)))
}
private func corrM1A(_ N: Double, _ p: Double) -> (Double, Double) {
    fromSinCos(-0.3593 * sin(2 * p) - 0.2 * sin(N) - 0.066 * sin(2 * p - N),
               1 + 0.3593 * cos(2 * p) + 0.2 * cos(N) + 0.066 * cos(2 * p - N))
}
private func corrGamma2(_ N: Double, _ p: Double) -> (Double, Double) {
    fromSinCos(0.147 * sin(2 * (N - p)), 1 + 0.147 * cos(2 * (N - p)))
}
private func corrAlpha2(_ p: Double, _ pp: Double) -> (Double, Double) {
    fromSinCos(-0.0446 * sin(p - pp), 1 - 0.0446 * cos(p - pp))
}
private func corrDelta2(_ N: Double) -> (Double, Double) {
    fromSinCos(0.477 * sin(N), 1 - 0.477 * cos(N))
}
private func corrXiEta2(_ N: Double) -> (Double, Double) {
    fromSinCos(-0.439 * sin(N), 1 + 0.439 * cos(N))
}
private func corrL2(_ N: Double, _ p: Double) -> (Double, Double) {
    fromSinCos(-0.2505 * sin(2 * p) - 0.1102 * sin(2 * p - N) - 0.0156 * sin(2 * p - 2 * N) - 0.037 * sin(N),
               1 - 0.2505 * cos(2 * p) - 0.1102 * cos(2 * p - N) - 0.0156 * cos(2 * p - 2 * N) - 0.037 * cos(N))
}

/// IHO node correction for a base constituent name, or nil if it has no explicit
/// fundamental (compound constituents derive theirs from members — see Constituent).
/// `perigeeTurns` is how many turns of p the argument being corrected holds, when it isn't the catalog's.
func ihoCorrection(_ name: String, _ a: Astro, perigeeTurns: Double? = nil) -> (f: Double, u: Double)? {
    let N = d2r * a.N, p = d2r * a.p, pp = d2r * a.pp
    let r: (Double, Double)
    switch name {
    case "Mm": r = corrMm(N, p)
    case "Mf": r = corrMf(N)
    case "O1": r = corrO1(N)
    case "K1": r = corrK1(N)
    case "J1": r = corrJ1(N)
    case "M1B": r = corrM1B(N, p)
    // Annex A's M1 formula is for an argument without p (1 555 556), so u takes off the p the argument holds.
    case "M1C", "M1":
        let m1 = corrM1(N, p)
        let turns = perigeeTurns ?? (name == "M1" ? 1 : 0)
        r = (m1.0, wrapDegrees(m1.1 - turns * a.p))
    case "M1A": r = corrM1A(N, p)
    case "M2": r = corrM2(N)
    case "K2": r = corrK2(N)
    case "M3": r = corrM3(N)
    case "L2": r = corrL2(N, p)
    case "gamma2": r = corrGamma2(N, p)
    case "alpha2": r = corrAlpha2(p, pp)
    case "delta2": r = corrDelta2(N)
    case "xi2", "eta2": r = corrXiEta2(N)
    default: return nil
    }
    return (f: r.0, u: r.1)
}
