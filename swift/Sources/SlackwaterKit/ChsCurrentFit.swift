// Slackwater — MIT. The CHS current gate fit recipe shared by every client.

import Foundation

/// How every Slackwater client fits a Canadian Hydrographic Service current
/// gate: IWLS `wcsp1` speed and `wcdp1` direction predictions on a
/// `sampleMinutes` grid, combined into signed flood-axis velocity by
/// `project(speeds:directions:floodDirection:)`, and fitted with
/// `fit(samples:constituents: basis)`. TypeScript's `chsCurrentFit` and
/// Kotlin's `ChsCurrentFit` carry the same values, and all three are checked
/// against `fixtures/chs-current-fit.json`.
///
/// A gate fits over one of `days`, chosen per gate from validation: separating
/// K1 from P1 takes at least 183 days, so most gates need 210. A 210-day gate
/// can publish the fit of its trailing 60 days first, as a provisional answer,
/// when that fit matched every slack and its worst slack error, rounded up to
/// 5 minutes, was measured at or below `provisionalSlackMaxMinutes`.
public enum ChsCurrentFit {
    public static let speedSeries = "wcsp1"
    public static let directionSeries = "wcdp1"
    public static let basis = ChsTideFit.basis
    public static let days = [60, 210]
    public static let sampleMinutes = 15
    public static let provisionalSlackMaxMinutes = 45

    /// Signed velocity along the gate's flood axis: speed · cos(direction −
    /// floodDirection), positive on the flood. The projection is linear, so
    /// fitting it is equivalent to fitting both velocity components and
    /// projecting the result. A speed sample without a direction at the same
    /// instant is dropped, as is one whose speed or direction is not finite;
    /// when a direction is repeated, its first value counts. Samples come back
    /// in the order of `speeds`.
    public static func project(speeds: [HarmonicSample], directions: [HarmonicSample],
                               floodDirection: Double) -> [HarmonicSample] {
        var directionAt: [Date: Double] = [:]
        for d in directions where directionAt[d.time] == nil { directionAt[d.time] = d.value }
        return speeds.compactMap { s in
            guard let direction = directionAt[s.time], direction.isFinite, s.value.isFinite else { return nil }
            return HarmonicSample(time: s.time, value: s.value * cos((direction - floodDirection) * .pi / 180))
        }
    }
}
