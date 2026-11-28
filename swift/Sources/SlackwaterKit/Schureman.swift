// Slackwater — MIT. Port of packages/engine/src/node-corrections/schureman.ts.
import Foundation

private let d2r = Double.pi / 180
private let r2d = 180 / Double.pi

/// Schureman's amplitude factor and phase in degrees for a fundamental.
/// A missing formula lets the catalog resolve the constituent through its members.
func schuremanCorrection(_ name: String, _ a: Astro, perigeeTurns: Double) -> (f: Double, u: Double)? {
    let omega = d2r * a.omega
    let i = d2r * a.i
    let inclination = d2r * a.I
    let nu = d2r * a.nu
    let sinI = sin(inclination)
    let cosHalfI = cos(inclination / 2)
    let cosHalfIOrbit = pow(cos(i / 2), 4)
    let inclinationMean = 1 - 1.5 * pow(sin(i), 2)
    let uM2 = 2 * (a.xi - a.nu)

    switch name {
    case "Mm": // Equations 73, 65
        let mean = (2.0 / 3 - pow(sin(omega), 2)) * inclinationMean
        return ((2.0 / 3 - pow(sinI, 2)) / mean, 0)
    case "Mf": // Equations 74, 66
        return (pow(sinI, 2) / (pow(sin(omega), 2) * cosHalfIOrbit), -2 * a.xi)
    case "O1": // Equations 75, 67
        return (schuremanO1(omega, cosHalfIOrbit, sinI, cosHalfI), 2 * a.xi - a.nu)
    case "J1": // Equations 76, 68
        return (sin(2 * inclination) / (sin(2 * omega) * inclinationMean), -a.nu)
    case "OO1": // Equations 77, 69
        let mean = sin(omega) * pow(sin(omega / 2), 2) * cosHalfIOrbit
        return (sinI * pow(sin(inclination / 2), 2) / mean, -2 * a.xi - a.nu)
    case "M2": // Equations 78, 70
        return (schuremanM2(omega, cosHalfIOrbit, cosHalfI), uM2)
    case "K1": // Equations 227, 226, 68
        let sin2I = sin(2 * inclination)
        let mean = 0.5023 * sin(2 * omega) * inclinationMean + 0.1681
        let amplitude = sqrt(0.2523 * pow(sin2I, 2) + 0.1689 * sin2I * cos(nu) + 0.0283)
        return (amplitude / mean, -a.nup)
    case "K2": // Equations 235, 234, 71
        let mean = 0.5023 * pow(sin(omega), 2) * inclinationMean + 0.0365
        let amplitude = sqrt(0.2523 * pow(sinI, 4) + 0.0367 * pow(sinI, 2) * cos(2 * nu) + 0.0013)
        return (amplitude / mean, -2 * a.nupp)
    case "L2": // Equations 215, 213, 204, 214
        let perigee = d2r * a.P
        let t = pow(tan(inclination / 2), 2)
        let amplitude = sqrt(1 - 12 * t * cos(2 * perigee) + 36 * t * t)
        let phase = r2d * atan(sin(2 * perigee) / (1 / (6 * t) - cos(2 * perigee)))
        return (schuremanM2(omega, cosHalfIOrbit, cosHalfI) * amplitude, uM2 - phase)
    case "M1": // Equations 206, 207, 195, 202
        let perigee = d2r * a.P
        let cosI = cos(inclination)
        let ratio = cosI / pow(cosHalfI, 2)
        let amplitude = sqrt(0.25 + 1.5 * ratio * cos(2 * perigee) + 2.25 * ratio * ratio)
        let k = (5 * cosI - 1) / (7 * cosI + 1)
        // atan2 keeps Q in P's half-turn. Equation 202 uses an argument without p.
        let q = r2d * atan2(k * sin(perigee), cos(perigee))
        return (schuremanO1(omega, cosHalfIOrbit, sinI, cosHalfI) * amplitude,
                wrapDegrees(a.xi - a.nu + q - perigeeTurns * a.p))
    case "M3": // Equation 149
        return (pow(schuremanM2(omega, cosHalfIOrbit, cosHalfI), 1.5), 1.5 * uM2)
    default:
        return nil
    }
}

private func schuremanO1(_ omega: Double, _ cosHalfIOrbit: Double, _ sinI: Double, _ cosHalfI: Double) -> Double {
    sinI * pow(cosHalfI, 2) / (sin(omega) * pow(cos(omega / 2), 2) * cosHalfIOrbit)
}

private func schuremanM2(_ omega: Double, _ cosHalfIOrbit: Double, _ cosHalfI: Double) -> Double {
    pow(cosHalfI, 4) / (pow(cos(omega / 2), 4) * cosHalfIOrbit)
}
