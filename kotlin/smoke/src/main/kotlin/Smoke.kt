import io.openwaters.slackwater.*
import io.openwaters.slackwater.iwls.IwlsClient
import io.openwaters.slackwater.iwls.IwlsFetch
import io.openwaters.slackwater.iwls.IwlsSampleGrid
import java.time.Instant
import java.time.ZoneId

fun main() {
    val from = Instant.parse("2026-06-01T00:00:00Z")
    val to = from.plusSeconds(2 * 86400)
    val constituents = listOf(HarmonicConstituent("M2", 1.0, 0.0))
    val tide = Station(constituents)
    val heights = tide.heights(from, to)
    check(heights.isNotEmpty() && heights.all { it.heightMetres.isFinite() })
    check(tide.rates(from, to).all { it.rateMetresPerHour.isFinite() })
    check(tide.extremes(from, to).isNotEmpty())
    val current = CurrentStation(constituents)
    val speeds = current.speeds(from, to)
    check(speeds.isNotEmpty() && speeds.all { it.speedKnots.isFinite() })
    check(current.events(from, to).isNotEmpty())
    check(current.slacks(from, to).isNotEmpty())
    check(current.maxima(from, to).isNotEmpty())
    val subTide = SubordinateTideStation(tide, 60.0, -60.0, HeightOffset.Ratio(1.1, 0.9))
    check(subTide.heights(from, to).isNotEmpty())
    check(subTide.rates(from, to).isNotEmpty())
    check(subTide.extremes(from, to).isNotEmpty())
    val subCurrent = SubordinateCurrentStation(current, 60.0, -60.0, 120.0, -120.0, 1.1, 0.9)
    check(subCurrent.events(from, to).isNotEmpty())
    check(subCurrent.speeds(from, to).all { it.speedKnots.isFinite() })
    check(constituentAstronomy("M2", from) != null)
    val fitEnd = IwlsFetch.localMidnight(from, ZoneId.of("America/Vancouver"))
    check(IwlsFetch.chunkPlan(60.0, fitEnd).size in 9..10)
    val grids = listOf(IwlsSampleGrid(ChsTideFit.SAMPLE_MINUTES), IwlsSampleGrid(ChsCurrentFit.SAMPLE_MINUTES))
    check(grids.all { it.resolution.isNotEmpty() })
    // A client loads the coroutines runtime and decoding loads serialization; neither sends anything.
    check(IwlsClient().toString().isNotEmpty())
    check(IwlsFetch.decode("""[{"eventDate":"2026-06-01T00:00:00Z","value":1.5}]""").single().value == 1.5)
    println("Public API consumer passed")
}
