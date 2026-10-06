import Foundation
import Testing
@testable import SlackwaterKit

private struct RankingFixture: Decodable {
    let offset: Double
    let constituents: [C]
    struct C: Decodable { let name: String; let amplitude: Double; let phase: Double }
}

private func extreme(_ hour: Double, _ height: Double, _ kind: ExtremeKind) -> TideExtreme {
    TideExtreme(time: Date(timeIntervalSince1970: hour * 3600), height: height, kind: kind)
}

@Test func rangesPairEveryRiseAndFall() {
    let got = [extreme(0, -1, .low), extreme(6, 3, .high),
               extreme(12, -0.5, .low), extreme(18, 2, .high)].ranges()

    #expect(got.count == 3, "four extremes bracket three ranges, got \(got.count)")
    #expect(got.map(\.isRising) == [true, false, true])
    #expect(got.map(\.height) == [4, 3.5, 2.5])
    // The range is "at" its later turn, whichever kind that is.
    #expect(got.map { $0.time.timeIntervalSince1970 / 3600 } == [6, 12, 18])
}

@Test func rangesNeedTwoExtremesOfOppositeKind() {
    #expect([TideExtreme]().ranges().isEmpty)
    #expect([extreme(0, -1, .low)].ranges().isEmpty)
    // Two lows with nothing after them never turn, so there is no range.
    #expect([extreme(0, -1, .low), extreme(2, -0.9, .low)].ranges().isEmpty)
}

@Test func sameKindRunsCollapseToTheirTrueExtreme() {
    // A dropped shallow high leaves two lows adjacent. The rise that follows
    // starts from the LOWER of them — 4.0 m of water, not 3.9.
    let afterDroppedHigh = [extreme(0, -1, .low), extreme(6, -0.9, .low), extreme(12, 3, .high)].ranges()
    #expect(afterDroppedHigh.count == 1)
    #expect(afterDroppedHigh[0].height == 4)
    #expect(afterDroppedHigh[0].low.height == -1)

    // Symmetrically, a run of highs keeps the highest.
    let afterDroppedLow = [extreme(0, 2, .high), extreme(6, 3, .high), extreme(12, -1, .low)].ranges()
    #expect(afterDroppedLow.count == 1)
    #expect(afterDroppedLow[0].height == 4)
    #expect(afterDroppedLow[0].high.height == 3)
}

@Test func invertedPairsAreNotRanges() {
    // A subordinate corrects highs and lows independently, so a shallow neap
    // under .ratio(high: 0.5, low: 1.0) puts the "high" below the "low".
    // That is an artifact of the offsets, not water.
    #expect([extreme(0, 0.4, .low), extreme(6, 0.25, .high)].ranges().isEmpty)
    // A zero-height pair is equally not a swing.
    #expect([extreme(0, 1, .low), extreme(6, 1, .high)].ranges().isEmpty)
    // ...and dropping it does not disturb the pairs on either side.
    let mixed = [extreme(0, -1, .low), extreme(6, 3, .high),
                 extreme(12, 0.4, .low), extreme(18, 0.25, .high),
                 extreme(24, -0.5, .low), extreme(30, 2.5, .high)].ranges()
    // The inverted low→high pair is gone; the ebb into it and the flood out of
    // it both still resolve.
    #expect(mixed.map(\.height) == [4, 2.6, 0.75, 3])
}

@Test func percentileRankCountsTiesAsBelow() {
    let values = [1.0, 2, 3, 4]
    #expect(values.percentileRank(of: 0) == 0)      // nothing at or below
    #expect(values.percentileRank(of: 1) == 0.25)   // the minimum still ranks above nothing
    #expect(values.percentileRank(of: 2.5) == 0.5)
    #expect(values.percentileRank(of: 4) == 1)
    #expect(values.percentileRank(of: 99) == 1)
    #expect([Double]().percentileRank(of: 1) == nil)
    // Ties count as below, so a repeated value carries all of its copies.
    #expect([1.0, 1, 1, 4].percentileRank(of: 1) == 0.75)
}

@Test func percentileRoundTripsAtTheBounds() {
    let values = [4.0, 1, 3, 2]  // deliberately unsorted
    #expect(values.percentile(0) == 1)
    #expect(values.percentile(1) == 4)
    #expect(values.percentile(0.5) == 3, "nearest-rank, no interpolation between 2 and 3")
    #expect(values.percentile(-1) == 1, "p clamps low")
    #expect(values.percentile(2) == 4, "p clamps high")
    #expect([Double]().percentile(0.5) == nil)
}

@Test func aYearOfFridayHarborRanksItsOwnLowestLow() throws {
    let fx = try loadFixture("realworld-friday-harbor", as: RankingFixture.self)
    let station = Station(constituents: fx.constituents.map {
        HarmonicConstituent(name: $0.name, amplitude: $0.amplitude, phase: $0.phase)
    }, offset: fx.offset)

    let start = Date(timeIntervalSince1970: 1_767_225_600)  // 2026-01-01Z
    let extremes = station.extremes(from: start, to: start.addingTimeInterval(365 * 86400))
    let lows = extremes.filter { $0.kind == .low }.map(\.height)
    let lowest = try #require(lows.min())

    // The year's lowest low is the only thing at or below itself.
    #expect(lows.percentileRank(of: lowest) == 1 / Double(lows.count))
    // NOAA publishes a 19-year LAT of 0.051 m STND for 9449880 against MLLW at
    // 1.174, i.e. -1.123 m on chart datum. 2026's lowest low lands 1 cm below
    // that — the epoch drifts (NOAA's is 1983-2001) but not by much. This is
    // the engine-side check that the relative ranking here and the absolute
    // LAT yardstick in slackwater-database describe the same water.
    #expect(abs(lowest - -1.123) < 0.02, "lowest low of 2026: \(lowest), NOAA LAT -1.123")

    // Ranking is monotonic: a lower low never ranks above a higher one.
    let sorted = lows.sorted()
    for (a, b) in zip(sorted, sorted.dropFirst()) {
        #expect(lows.percentileRank(of: a)! <= lows.percentileRank(of: b)!)
    }

    // Every extreme but the last opens a range, minus any same-kind neighbours.
    let ranges = extremes.ranges()
    let sameKind = zip(extremes, extremes.dropFirst()).filter { $0.kind == $1.kind }.count
    #expect(ranges.count == extremes.count - 1 - sameKind)
    #expect(ranges.allSatisfy { $0.height > 0 }, "a range is always positive water")

    // The biggest swing of the year is a spring range, well above the median.
    let heights = ranges.map(\.height)
    let biggest = try #require(heights.max())
    #expect(biggest > heights.percentile(0.5)!)
    #expect(heights.percentileRank(of: biggest) == 1)
}
