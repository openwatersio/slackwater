import Foundation
import Testing
@testable import SlackwaterKit

// Mirrors packages/engine/test/readings/{series,current,tide}.test.ts, then
// checks parity with fixtures/readings.json from the TypeScript engine.

private let t0 = parseISO("2026-10-10T00:00:00Z")
private let H: TimeInterval = 3600
private let M: TimeInterval = 60
private func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

/// One sine cycle per 12 h at 3 kn, sampled every 10 minutes for a day.
private let sine = (0..<145).map { i in
    CurrentPoint(time: at(Double(i) * 600), speed: 3 * sin(2 * Double.pi * Double(i) / 72))
}
private let sineEvents = [
    CurrentEvent(time: at(3 * H), speed: 3, kind: .maxFlood),
    CurrentEvent(time: at(6 * H), speed: 0, kind: .slack),
    CurrentEvent(time: at(9 * H), speed: -3, kind: .maxEbb),
]
/// Ten-minute one-axis samples from t0 with the given speeds.
private func series(_ speeds: [Double]) -> [CurrentPoint] {
    speeds.enumerated().map { CurrentPoint(time: at(Double($0.offset) * 10 * M), speed: $0.element) }
}
private func slackAt(_ time: Date) -> CurrentEvent { CurrentEvent(time: time, speed: 0, kind: .slack) }
/// A vector sample `h` hours after t0.
private func point(_ h: Double, _ speed: Double, _ magnitude: Double, _ direction: Double? = nil) -> CurrentPoint {
    CurrentPoint(time: at(h * H), speed: speed, magnitude: magnitude, direction: direction)
}
private func near(_ a: Double?, _ b: Double, _ tolerance: Double = 1e-6) -> Bool {
    guard let a else { return false }
    return abs(a - b) < tolerance
}
private func seconds(_ date: Date?) -> Double { date?.timeIntervalSince(t0) ?? .nan }

@Test func interpolationReadsAtAndBetweenSamplesOnly() {
    let times = [0.0, 1, 2, 2].map { at($0 * H) }
    let heights = zip(times, [0.0, 2, 2, 6]).map { TidePoint(time: $0, height: $1) }
    #expect(heights.height(at: at(0.25 * H)) == 0.5)
    #expect(heights.height(at: at(-0.001)) == nil)
    #expect(heights.height(at: at(3 * H)) == nil)
    #expect([TidePoint]().height(at: t0) == nil)
    // The first of two samples sharing an instant.
    #expect(heights.height(at: at(2 * H)) == 2)
    let only = [TidePoint(time: t0, height: 2)]
    #expect(only.height(at: t0) == 2)
    #expect(only.height(at: at(0.001)) == nil)

    #expect(near(sine.speed(at: at(300)), (sine[0].speed + sine[1].speed) / 2, 1e-12))
    #expect(sine.speed(at: at(-0.001)) == nil)
    #expect([CurrentPoint]().speed(at: t0) == nil)
    #expect([sine[0], sine[0]].speed(at: t0) == sine[0].speed)

    let rates = [TideRatePoint(time: t0, rate: 1), TideRatePoint(time: at(H), rate: 2)]
    #expect(rates.rate(at: at(0.5 * H)) == 1.5)
    #expect(rates.rate(at: at(H + 0.001)) == nil)
}

@Test func vectorsInterpolateThroughBearings() throws {
    // Through north rather than turning south.
    let north = try #require([point(0, 1, 1, 350), point(1, 1, 1, 10)].vector(at: at(H / 2), flood: nil, ebb: nil))
    #expect(near(north.magnitude, 0.984807753))
    #expect(angularDiff(try #require(north.direction), 0) < 1e-9)
    // Opposite vectors cancel without inventing a set.
    let cancel = try #require([point(0, 1, 1, 90), point(1, -1, 1, 270)].vector(at: at(H / 2), flood: nil, ebb: nil))
    #expect(cancel.magnitude < 1e-9 && cancel.direction == nil)
    // From a zero vector with no bearing.
    let fromZero = [point(0, 0, 0), point(1, 1, 1, 90)]
    #expect(fromZero.vector(at: t0, flood: nil, ebb: nil) == CurrentVector(magnitude: 0, direction: nil))
    #expect(fromZero.vector(at: at(H / 2), flood: nil, ebb: nil) == CurrentVector(magnitude: 0.5, direction: 90))
    // A known endpoint beside an unknown one keeps speed without a set.
    let unknown = [point(0, 1, 2, 90), point(1, 1, 3)]
    #expect(unknown.vector(at: t0, flood: nil, ebb: nil) == CurrentVector(magnitude: 2, direction: 90))
    #expect(unknown.vector(at: at(H / 2), flood: nil, ebb: nil) == CurrentVector(magnitude: 2.5, direction: nil))
    #expect(unknown.vector(at: at(H), flood: nil, ebb: nil) == CurrentVector(magnitude: 3, direction: nil))
    // Outside the series, or none at all.
    #expect([point(0, 1, 1, 350), point(1, 1, 1, 10)].vector(at: at(-0.001), flood: nil, ebb: nil) == nil)
    #expect([point(0, 1, 1, 350), point(1, 1, 1, 10)].vector(at: at(H + 0.001), flood: nil, ebb: nil) == nil)
    #expect([CurrentPoint]().vector(at: t0, flood: nil, ebb: nil) == nil)
}

@Test func oneAxisSamplesKeepNonreciprocalBearings() throws {
    for sign in [1.0, -1.0] {
        // Engine one-axis points carry their bearing; caller-built ones take the published set.
        let engine = [point(0, 0.3 * sign, 0.3, sign > 0 ? 45 : 200), point(1, -0.3 * sign, 0.3, sign > 0 ? 200 : 45)]
        let scalar = [CurrentPoint(time: t0, speed: 0.3 * sign), CurrentPoint(time: at(H), speed: -0.3 * sign)]
        for timeline in [engine, scalar] {
            let zero = try #require(timeline.vector(at: at(H / 2), flood: 45, ebb: 200))
            #expect(zero.magnitude == 0 && zero.direction == nil)
            let before = try #require(timeline.vector(at: at(0.4 * H), flood: 45, ebb: 200))
            #expect(near(before.magnitude, 0.06) && before.direction == (sign > 0 ? 45 : 200))
            let after = try #require(timeline.vector(at: at(0.6 * H), flood: 45, ebb: 200))
            #expect(near(after.magnitude, 0.06) && after.direction == (sign > 0 ? 200 : 45))
        }
        let end = try #require(scalar.vector(at: at(H), flood: 45, ebb: 200))
        #expect(end == CurrentVector(magnitude: 0.3, direction: sign > 0 ? 200 : 45))
    }
    // Older sources: absolute signed speed, the phase's set, none at zero.
    #expect(near(sine.vector(at: at(8 * H), flood: nil, ebb: 200)?.magnitude, 2.598076211353316))
    #expect(sine.vector(at: at(8 * H), flood: nil, ebb: 200)?.direction == 200)
    #expect(sine.vector(at: at(2 * H), flood: nil, ebb: nil)?.direction == nil)
    let slack = try #require(sine.vector(at: at(6 * H), flood: 45, ebb: 225))
    #expect(slack.magnitude < 1e-9 && slack.direction == nil)
}

@Test func readCurrentNamesThePhase() throws {
    let crossflow = [point(0, 0, 2, 90), point(1, -1, 2, 120)]
    #expect(readCurrent(at: t0, timeline: crossflow, events: [slackAt(t0)], flood: 0, ebb: 180)
        == CurrentReading(state: .slack, speed: 0, magnitude: 2, direction: 90))
    #expect(readCurrent(at: at(6 * H), timeline: sine, events: sineEvents, flood: 45, ebb: 225)?.state == .slack)
    #expect(readCurrent(at: at(6 * H + 1), timeline: sine, events: sineEvents, flood: 45, ebb: 225)?.state == .slack)
    #expect(readCurrent(at: at(6 * H + 1.001), timeline: sine, events: sineEvents, flood: 45, ebb: 225)?.state == .ebbing)
    let flood = try #require(readCurrent(at: at(3 * H - 1), timeline: sine, events: sineEvents, flood: 45, ebb: 225))
    #expect(flood.state == .maxFlood && flood.direction == 45)
    #expect(readCurrent(at: at(9 * H), timeline: sine, events: sineEvents, flood: 45, ebb: 225)?.state == .maxEbb)
    let weak = CurrentEvent(time: at(10 * M), speed: 0.2, kind: .maxFlood)
    #expect(readCurrent(at: at(10 * M), timeline: series([0.1, 0.2, 0.1]), events: [weak], flood: 45, ebb: 225)?.state == .maxFlood)
    let before = try #require(readCurrent(at: at(6 * H - 5 * M), timeline: sine, events: sineEvents, flood: 45, ebb: 225))
    #expect(before.state == .flooding && before.direction == 45)
    let after = try #require(readCurrent(at: at(6 * H + 5 * M), timeline: sine, events: sineEvents, flood: 45, ebb: 225))
    #expect(after.state == .ebbing && after.direction == 225)
    let ebb = try #require(readCurrent(at: at(8 * H), timeline: sine, events: sineEvents, flood: 45, ebb: 200))
    #expect(ebb.direction == 200 && spokenCompassPoints[compassIndex(200)] == "south-southwest")
    #expect(readCurrent(at: at(2 * H), timeline: sine, events: sineEvents, flood: nil, ebb: nil)?.direction == nil)
    #expect(readCurrent(at: at(-H), timeline: sine, events: sineEvents, flood: 45, ebb: 225) == nil)
    #expect(readCurrent(at: sine[0].time, timeline: sine, events: sineEvents, flood: nil, ebb: nil) != nil)
    #expect(readCurrent(at: sine[144].time, timeline: sine, events: sineEvents, flood: nil, ebb: nil) != nil)
    #expect(readCurrent(at: sine[144].time.addingTimeInterval(0.001), timeline: sine, events: sineEvents, flood: nil, ebb: nil) == nil)
}

@Test func compassPointsNameBearings() {
    #expect(compassPoint(0) == "N")
    #expect(compassPoint(349) == "N")
    #expect(compassPoint(22.5) == "NNE")
    #expect(compassPoint(225) == "SW")
    #expect(compassPoint(-90) == "W")
    #expect(compassPoint(-11.25) == "N")
    #expect(compassPoint(371.25) == "NNE")
    #expect(spokenCompassPoints[compassIndex(22.5)] == "north-northeast")
    #expect(compassPoints.count == 16 && spokenCompassPoints.count == 16)
}

@Test func slackWindowSpansTheBand() throws {
    #expect(defaultSlackThreshold == 0.5)
    // |3 sin θ| ≤ 0.5 within asin(1/6) of the reversal: about 19 minutes each side.
    let w = try #require(slackWindow(sine, around: at(6 * H), threshold: 0.5))
    let half = asin(1.0 / 6) / (2 * Double.pi) * 12 * H
    #expect(abs((6 * H - seconds(w.start)) - half) < 30)
    #expect(abs((seconds(w.end) - 6 * H) - half) < 30)
    // A signed band crossing across a reversal matches iOS.
    for direction in [-1.0, 1.0] {
        let s = try #require(slackWindow(series([-1, 0.1, 1].map { $0 * direction }), around: at(545.45), threshold: 0.15))
        #expect(abs(seconds(s.start) - 463.64) < 0.05)
        #expect(abs(seconds(s.end) - 633.33) < 0.05)
    }
    // A reversal between two out-of-band samples crosses the band along the segment.
    #expect(slackWindow(series([2, 1, -1, -2]), around: at(15 * M), threshold: 0.5)
        == SlackWindow(start: at(12.5 * M), end: at(17.5 * M)))
    let later = try #require(slackWindow(series([2, 1, 0.25, -1, -2]), around: at(22 * M), threshold: 0.5))
    #expect(abs(seconds(later.start) - (10 * M + 10 * M * 0.5 / 0.75)) < 1e-6)
    #expect(abs(seconds(later.end) - 26 * M) < 1e-6)
    // Widens to hold its slack.
    let wide = try #require(slackWindow(series([2, 1, -3, -4]), around: at(19 * M), threshold: 0.5))
    #expect(abs(seconds(wide.start) - 11.25 * M) < 1e-6 && wide.end == at(19 * M))
    #expect(slackWindow(series([0.3, -3]), around: at(6 * M), threshold: 0.5)?.end == at(6 * M))
    // Clamped to the series.
    #expect(slackWindow(series([0.2, -0.3]), around: at(4 * M), threshold: 0.5) == SlackWindow(start: t0, end: at(10 * M)))
    // None outside the series, without a band or a reversal, or at a threshold at or below zero.
    #expect(slackWindow(series([2, 1]), around: at(-0.001), threshold: 0.5) == nil)
    #expect(slackWindow([], around: t0, threshold: 0.5) == nil)
    #expect(slackWindow(series([2, 1, 2]), around: at(5 * M), threshold: 0.5) == nil)
    #expect(slackWindow(series([2, 1]), around: at(10 * M), threshold: 0.5) == nil)
    #expect(slackWindow(sine, around: at(6 * H), threshold: 0) == nil)
    #expect(slackWindow(sine, around: at(6 * H), threshold: -1) == nil)
}

@Test func mergeWindowsJoinsTouchingWindows() {
    let windows = [SlackWindow(start: at(0), end: at(10)), SlackWindow(start: at(10), end: at(20)),
                   SlackWindow(start: at(12), end: at(15)), SlackWindow(start: at(30), end: at(40))]
    #expect(mergeWindows(windows) == [SlackWindow(start: at(0), end: at(20)), SlackWindow(start: at(30), end: at(40))])
    #expect(mergeWindows([]) == [])
}

@Test func slackRunsMergeWindowsAroundSlacks() throws {
    let shared = slackRuns(series([1, 0.2, -0.2, 0.2, -0.2, -1]),
                           events: [slackAt(at(15 * M)), slackAt(at(25 * M)), slackAt(at(35 * M))], threshold: 0.5)
    #expect(shared.count == 1)
    #expect(try #require(shared.first).start < at(10 * M) && shared[0].end > at(40 * M))
    let tail = try #require(slackRuns(series([2, 1, -3, -4]), events: [slackAt(at(12 * M)), slackAt(at(19 * M))], threshold: 0.5).first)
    #expect(abs(seconds(tail.start) - 11.25 * M) < 1e-6 && tail.end == at(19 * M))
    #expect(slackRuns(sine, events: sineEvents + [slackAt(at(12 * H)), slackAt(at(-H))], threshold: 0.5).count == 2)
    #expect(slackRuns(series([2, 1, 2]), events: [slackAt(at(5 * M))], threshold: 0.5) == [SlackWindow(start: at(5 * M), end: at(5 * M))])
    #expect(slackRuns(sine, events: sineEvents, threshold: 0) == [SlackWindow(start: at(6 * H), end: at(6 * H))])
    #expect(slackRuns([], events: sineEvents, threshold: 0.5) == [])
}

/// Hourly tide samples from t0 with the given heights.
private func tide(_ heights: [Double]) -> [TidePoint] {
    heights.enumerated().map { TidePoint(time: at(Double($0.offset) * H), height: $0.element) }
}
private func turn(_ hours: Double, _ height: Double, _ high: Bool) -> TideExtreme {
    TideExtreme(time: at(hours * H), height: height, kind: high ? .high : .low)
}
private func rate(_ value: Double, _ i: Int) -> TideRatePoint { TideRatePoint(time: at(Double(i) * H), rate: value) }

@Test func ratesAreSampledCentralDifferences() {
    let rates = tide([0, 1, 3, 3.5]).rates()
    #expect(rates.map(\.rate) == [1, 1.5, 1.25, 0.5])
    #expect(rates[1].time == at(H))
    #expect(tide([2]).rates().map(\.rate) == [0])
    #expect([TidePoint(time: t0, height: 1), TidePoint(time: t0, height: 2)].rates().map(\.rate) == [0, 0])
    #expect(tide([]).rates().isEmpty)
    #expect(near(tide([0, 1, 3]).rates().rate(at: at(0.5 * H)), 1.25))
}

@Test func flowPeaksTakeEachRunsFastestSample() {
    func pairs(_ points: [TideRatePoint]) -> [[Double]] { points.map { [seconds($0.time), $0.rate] } }
    let rates = [0.2, 0.7, 0.9, 0.4, -0.3, -0.5, -0.1, 0.65, 0.6].enumerated().map { rate($1, $0) }
    #expect(pairs(flowPeaks(rates, floor: 0.6)) == pairs([rate(0.9, 2), rate(0.65, 7)]))
    #expect(pairs(flowPeaks([0.8, 0, 1.2].enumerated().map { rate($1, $0) }, floor: 0.6)) == pairs([rate(0.8, 0), rate(1.2, 2)]))
    #expect(pairs(flowPeaks([-0.7, -1.1, -0.9].enumerated().map { rate($1, $0) }, floor: 0.6)) == pairs([rate(-1.1, 1)]))
    #expect(flowPeaks(tide([0, 0.1, 0.3, 0.2, 0]).rates(), floor: 0).map { $0.rate > 0 } == [true, false])
    let window = tide([5, 1, 4, 9])
    #expect(window.range(from: at(H), to: at(2 * H)).map { [$0.min, $0.max] } == [1, 4])
    #expect(window.range(from: at(10 * H), to: at(11 * H)) == nil)
}

@Test func readTideNamesTheTurnOrTheTrend() throws {
    let flat = tide([1, 1, 1])
    let still = try #require(readTide(at: at(H), heights: flat, rates: flat.rates(), extremes: []))
    #expect(still.state == .rising && still.rate == 0)
    let heights = tide([1, 2, 3, 2, 1, 0, 1]), rates = heights.rates()
    let extremes = [turn(2, 3.04, true), turn(5, -0.02, false)]
    let high = try #require(readTide(at: at(2 * H + 1), heights: heights, rates: rates, extremes: extremes))
    #expect(high.state == .high && high.height == 3.04 && high.rising && near(high.rate, -1.0 / 3600, 1e-12))
    #expect(readTide(at: at(5 * H - 1), heights: heights, rates: rates, extremes: extremes)?.state == .low)
    #expect(readTide(at: at(2 * H + 1.001), heights: heights, rates: rates, extremes: extremes)?.state == .falling)
    #expect(readTide(at: at(0.5 * H), heights: heights, rates: rates, extremes: extremes)
        == TideReading(state: .rising, height: 1.5, rising: true, rate: 1))
    let falling = try #require(readTide(at: at(3.5 * H), heights: heights, rates: rates, extremes: extremes))
    #expect(falling.state == .falling && !falling.rising)
    // Without a later turn, the sampled rate decides.
    let drop = tide([1, 0.8, 0.6])
    for turns in [[], [turn(0, 1, true)]] {
        let r = try #require(readTide(at: at(H), heights: drop, rates: drop.rates(), extremes: turns))
        #expect(r.state == .falling && !r.rising && r.height == 0.8 && near(r.rate, -0.2))
    }
    #expect(readTide(at: at(5.5 * H), heights: heights, rates: rates, extremes: extremes)?.state == .rising)
    #expect(readTide(at: at(-0.001), heights: heights, rates: rates, extremes: extremes) == nil)
    #expect(readTide(at: t0, heights: heights, rates: rates, extremes: extremes) != nil)
    #expect(readTide(at: at(6 * H), heights: heights, rates: rates, extremes: extremes) != nil)
    #expect(readTide(at: at(6 * H + 0.001), heights: heights, rates: rates, extremes: extremes) == nil)
}

@Test func maxSpeedsAndSwingHeights() {
    let maxima = [CurrentEvent(time: t0, speed: 4.2, kind: .maxFlood),
                  CurrentEvent(time: at(3 * H), speed: 0, kind: .slack),
                  CurrentEvent(time: at(6 * H), speed: -6.4, kind: .maxEbb)]
    #expect(maxima.maxSpeeds(.maxEbb) == [6.4])
    #expect(maxima.maxSpeeds(.maxFlood) == [4.2])
    #expect([turn(0, 0, false), turn(6, 3, true), turn(12, 1, false)].swingHeights() == [3, 2])
    #expect([turn(0, 1, false), turn(3, 0.5, false), turn(6, 3, true)].swingHeights() == [2.5])
    #expect([turn(0, 0.5, false), turn(3, 1, false), turn(6, 3, true)].swingHeights() == [2.5])
    #expect([turn(0, 0, false), turn(3, 2, true), turn(6, 3, true), turn(9, 1, false)].swingHeights() == [2, 2])
    #expect([turn(0, 2, false), turn(6, 1, true)].swingHeights() == [])
    #expect([TideExtreme]().swingHeights() == [] && [turn(0, 1, true)].swingHeights() == [])
}

private struct ReadingsFixture: Decodable {
    let vector: Vector; let scalar: Scalar; let tide: Tide
    struct Event: Decodable {
        let time: String; let speed: Double; let kind: String
        var event: CurrentEvent {
            CurrentEvent(time: parseISO(time), speed: speed,
                         kind: kind == "slack" ? .slack : kind == "maxFlood" ? .maxFlood : .maxEbb)
        }
    }
    struct Reading: Decodable { let time: String; let state: String; let speed: Double; let magnitude: Double; let direction: Double? }
    struct Span: Decodable { let start: String; let end: String }
    struct Window: Decodable { let slack: String; let start: String; let end: String }
    struct Vector: Decodable {
        let floodDirection: Double; let ebbDirection: Double; let threshold: Double
        let timeline: [P]; let events: [Event]; let runs: [Span]; let windows: [Window]; let readings: [Reading]
        struct P: Decodable { let time: String; let speed: Double; let magnitude: Double; let direction: Double? }
    }
    struct Scalar: Decodable {
        let flood: Double; let ebb: Double
        let timeline: [P]; let events: [Event]; let readings: [Reading]
        struct P: Decodable { let time: String; let speed: Double }
    }
    struct Tide: Decodable {
        let timeline: [Level]; let extremes: [Turn]; let rates: [Rate]; let peaks: [Rate]
        let readings: [TideRead]; let swings: [Double]; let ranks: [Rank]
        struct Level: Decodable { let time: String; let level: Double }
        struct Turn: Decodable { let time: String; let level: Double; let high: Bool }
        struct Rate: Decodable { let time: String; let rate: Double }
        struct TideRead: Decodable { let time: String; let state: String; let level: Double; let up: Bool; let rate: Double }
        struct Rank: Decodable { let value: Double; let rank: Double }
    }
}

private func name(_ state: CurrentState) -> String {
    switch state {
    case .slack: "Slack"
    case .maxFlood: "Max flood"
    case .maxEbb: "Max ebb"
    case .flooding: "Flooding"
    case .ebbing: "Ebbing"
    }
}
private func name(_ state: TideState) -> String {
    switch state {
    case .high: "High"
    case .low: "Low"
    case .rising: "Rising"
    case .falling: "Falling"
    }
}
private func sameTime(_ a: Date, _ b: String) -> Bool { abs(a.timeIntervalSince(parseISO(b))) < 0.5 }

private func checkCurrent(_ expected: [ReadingsFixture.Reading], timeline: [CurrentPoint], events: [CurrentEvent],
                          flood: Double, ebb: Double) throws {
    for e in expected {
        let r = try #require(readCurrent(at: parseISO(e.time), timeline: timeline, events: events, flood: flood, ebb: ebb), "\(e.time)")
        #expect(name(r.state) == e.state, "\(e.time)")
        #expect(abs(r.speed - e.speed) < 1e-6, "\(e.time)")
        #expect(abs(r.magnitude - e.magnitude) < 1e-6, "\(e.time)")
        if let direction = e.direction {
            #expect(angularDiff(try #require(r.direction, "\(e.time)"), direction) < 1e-5, "\(e.time)")
        } else {
            #expect(r.direction == nil, "\(e.time)")
        }
    }
}

@Test func readingsMatchSharedFixture() throws {
    let f = try loadFixture("readings", as: ReadingsFixture.self)

    let v = f.vector
    let timeline = v.timeline.map {
        CurrentPoint(time: parseISO($0.time), speed: $0.speed, magnitude: $0.magnitude, direction: $0.direction)
    }
    let events = v.events.map(\.event)
    #expect(v.readings.count == 79)
    try checkCurrent(v.readings, timeline: timeline, events: events, flood: v.floodDirection, ebb: v.ebbDirection)
    let windows = events.filter { $0.kind == .slack }.compactMap { e in
        slackWindow(timeline, around: e.time, threshold: v.threshold).map { (slack: e.time, window: $0) }
    }
    #expect(windows.count == v.windows.count)
    for (actual, expected) in zip(windows, v.windows) {
        #expect(sameTime(actual.slack, expected.slack) && sameTime(actual.window.start, expected.start)
            && sameTime(actual.window.end, expected.end), "\(expected.slack)")
    }
    let runs = slackRuns(timeline, events: events, threshold: v.threshold)
    #expect(runs.count == v.runs.count)
    for (actual, expected) in zip(runs, v.runs) {
        #expect(sameTime(actual.start, expected.start) && sameTime(actual.end, expected.end), "\(expected.start)")
    }

    let s = f.scalar
    try checkCurrent(s.readings, timeline: s.timeline.map { CurrentPoint(time: parseISO($0.time), speed: $0.speed) },
                     events: s.events.map(\.event), flood: s.flood, ebb: s.ebb)

    let t = f.tide
    let heights = t.timeline.map { TidePoint(time: parseISO($0.time), height: $0.level) }
    let extremes = t.extremes.map { TideExtreme(time: parseISO($0.time), height: $0.level, kind: $0.high ? .high : .low) }
    let fixtureRates = t.rates.map { TideRatePoint(time: parseISO($0.time), rate: $0.rate) }
    let rates = heights.rates()
    #expect(rates.count == t.rates.count)
    for (actual, expected) in zip(rates, t.rates) {
        #expect(sameTime(actual.time, expected.time) && abs(actual.rate - expected.rate) < 1e-6, "\(expected.time)")
    }
    let peaks = flowPeaks(fixtureRates, floor: 0.6)
    #expect(peaks.count == t.peaks.count)
    for (actual, expected) in zip(peaks, t.peaks) {
        #expect(sameTime(actual.time, expected.time) && abs(actual.rate - expected.rate) < 1e-6, "\(expected.time)")
    }
    #expect(t.readings.count == 57)
    for e in t.readings {
        let r = try #require(readTide(at: parseISO(e.time), heights: heights, rates: fixtureRates, extremes: extremes), "\(e.time)")
        #expect(name(r.state) == e.state && r.rising == e.up, "\(e.time)")
        #expect(abs(r.height - e.level) < 1e-6 && abs(r.rate - e.rate) < 1e-6, "\(e.time)")
    }
    let swings = extremes.swingHeights()
    #expect(swings.count == t.swings.count)
    for (actual, expected) in zip(swings, t.swings) { #expect(abs(actual - expected) < 1e-6) }
    for r in t.ranks { #expect(near(swings.percentileRank(of: r.value), r.rank)) }
}
