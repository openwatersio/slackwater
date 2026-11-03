# Slackwater for Kotlin

An offline tide and current engine for Kotlin/JVM and Android. Callers supply station constants; the engine does no file or network I/O. Runtime dependencies are Kotlin's standard library and its transitive annotations artifact. The constituent catalog is compiled into the library from the same source as the TypeScript and Swift catalogs.

## Use from source

Builds use JDK 17, the Kotlin plugin version pinned in [`build.gradle.kts`](build.gradle.kts) and the checked-in Gradle wrapper. The library targets JVM 8 bytecode and uses `java.time.Instant`; Android consumers require `minSdk = 26` because [Instant was added in API 26](https://developer.android.com/reference/java/time/Instant). Android device execution is pending consumer integration testing.

This is a source distribution. The dependency below resolves through a composite build; it is not published to Maven Central. Check out the repository at a reviewed full commit SHA and keep that SHA in your application's dependency setup:

```sh
git clone https://github.com/openwatersio/slackwater.git vendor/slackwater
git -C vendor/slackwater checkout --detach <full-reviewed-commit-sha>
```

In your application's `settings.gradle.kts`:

```kotlin
includeBuild("vendor/slackwater/kotlin")
```

In its `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.openwaters:slackwater-engine:0.1.0")
}
```

See [smoke](smoke) for a complete separate consumer. Prediction needs no station database, JSON parser, Android framework or bundled asset.

## Use through JitPack

The engine is also served as a Maven artifact through [JitPack](https://jitpack.io), so projects can depend on it without a composite build. Add the JitPack repository and depend on a commit of this repository, using its first 10 hex digits as the version:

```kotlin
// Gradle (Kotlin DSL)
repositories { maven("https://jitpack.io") }
dependencies { implementation("com.github.openwatersio:slackwater:<commit>") }
```

```scala
// sbt
resolvers += "jitpack" at "https://jitpack.io"
libraryDependencies += "com.github.openwatersio" % "slackwater" % "<commit>"
```

The POM declares `kotlin-stdlib`, so consumers get it transitively. The artifact holds only the engine, not the IWLS module. From Java, pass the station offset explicitly because the Kotlin default is not visible there:

```java
Station station = new Station(Arrays.asList(new HarmonicConstituent("M2", 1.71, 133.7)), 0.0);
List<TideExtreme> highLow = station.extremes(from, from.plusSeconds(86400));
```

JitPack builds a commit the first time anyone requests it, which takes about a minute; the log is at `https://jitpack.io/com/github/openwatersio/slackwater/<commit>/build.log`. Built commits stay cached. The build is driven by two files at the repository root, so the Gradle build in `kotlin/` needs no publishing setup of its own:

- [`jitpack.yml`](../jitpack.yml) selects JDK 17 and runs `./gradlew :publishToMavenLocal` in `kotlin/` with configuration on demand, so IWLS is not configured and tests and coverage do not run.
- [`jitpack.gradle`](../jitpack.gradle) is a Gradle init script that applies `maven-publish` to the engine project and publishes its jar, sources jar and POM. On JitPack it sets the coordinates from JitPack's `GROUP`, `ARTIFACT` and `VERSION` variables, which gives `com.github.openwatersio:slackwater:<commit>`.

To check a change before pushing, run the same build locally and inspect the published POM:

```sh
cd kotlin
JITPACK=true GROUP=com.github.openwatersio ARTIFACT=slackwater VERSION=local \
  ./gradlew --configure-on-demand -I ../jitpack.gradle :publishToMavenLocal
cat ~/.m2/repository/com/github/openwatersio/slackwater/local/slackwater-local.pom
```

## Predict

```kotlin
import io.openwaters.slackwater.*
import java.time.Instant

val from = Instant.parse("2026-06-01T00:00:00Z")
val to = from.plusSeconds(2 * 86400)
val constants = listOf(HarmonicConstituent("M2", 1.0, 0.0))
val tide = Station(constants, offsetMetres = 0.5)
val heights: List<TidePoint> = tide.heights(from, to)
val rates: List<TideRatePoint> = tide.rates(from, to)
val highLow: List<TideExtreme> = tide.extremes(from, to)

val current = CurrentStation(constants, floodDirectionDegrees = 90.0, ebbDirectionDegrees = 270.0)
val speeds: List<CurrentPoint> = current.speeds(from, to)
val events: List<CurrentEvent> = current.events(from, to)
val slacks = current.slacks(from, to)
val maxima = current.maxima(from, to)
val astronomy: ConstituentAstronomy? = constituentAstronomy("M2", from)
```

The constants here illustrate the API, not a real station. Tide amplitudes, `offsetMetres` and heights are metres; rates are metres per hour. Current amplitudes, `offsetKnots` and speeds are signed knots, positive flood and negative ebb. Phases are GMT degrees. Directions are degrees true, normalized to `[0, 360)`; null means unpublished, and slacks have no direction.

All numeric inputs must be finite. Steps must be positive, representable at the requested epoch and at least one nanosecond. Timeline and event searches exceeding the indexed work/result range are rejected. Invalid inputs throw `IllegalArgumentException`. Reversed windows return empty lists. Equal timeline bounds produce the samples from outward snapping; event roots on an exact bracket boundary, and current slacks at a node-correction refresh, are not guaranteed. Steps default to 600 seconds; the start is floored and the end ceiled to the step on the UTC epoch grid. No default time zone enters prediction. Station constructors copy caller collections, and requests have independent calculation state.

Unknown names and zero amplitudes contribute nothing. Astronomy returns null for an unknown name. IHO node corrections are supported. `ChsTideFit` and `ChsCurrentFit` carry the CHS tide and current fit recipes shared with TypeScript and Swift, `ChsCurrentFit.STAMP` identifies the current recipe, and `ChsCurrentFit.project` makes a current gate's `HarmonicSample` series. The stamp is checked against `fixtures/chs-current-golden.json` and changes when a change moves the golden gate's predicted velocity by 1e-4 kn or more, a slack or peak by 30 seconds or more, or a peak's speed by 0.001 kn or more. Schureman, fitting, station lookup, datum resolution, ranking, derived slack and publication tooling are outside this port; CHS stations are resolved by the separate [IWLS module](#iwls-fetching).

## IWLS fetching

`io.openwaters:slackwater-iwls` fetches the inputs for fitting Canadian Hydrographic Service stations on the device, following the [IWLS fetching contract](../docs/iwls-fetch.md) and its shared fixtures. It is a separate module so the engine stays free of I/O and dependencies; it does not depend on the engine. Its runtime dependencies are `kotlinx-coroutines-core` and `kotlinx-serialization-json`, and like the engine it needs Android `minSdk = 26` for `java.time`. It is MIT licensed, as the engine and the Swift client it follows are. It resolves through the same composite build as the engine (see [Use from source](#use-from-source)); add it beside the engine:

```kotlin
dependencies {
    implementation("io.openwaters:slackwater-iwls:0.1.0")
}
```

```kotlin
import io.openwaters.slackwater.iwls.*
import java.time.Instant
import java.time.ZoneId

suspend fun victoriaSamples(client: IwlsClient = IwlsClient()): List<ChsSample> {
    val station = IwlsFetch.resolve("Victoria", 48.424, -123.371, "wlp", client.stationList())
    val end = IwlsFetch.localMidnight(Instant.now(), ZoneId.of("America/Vancouver"))
    val grid = IwlsSampleGrid(ChsTideFit.SAMPLE_MINUTES)
    return IwlsFetch.chunkPlan(60.0, end).flatMap { client.series("wlp", station.id, it, grid) }.sortedBy { it.tMillis }
}
```

Every client call is a `suspend` function. Requests from all default clients share one pacer, 2.5 seconds apart, and each call retries rate limits, server errors and dropped links as the contract specifies. Cancelling the coroutine ends pacing, backoff and the wait for the request at once. Apart from cancellation, every failure is an `IwlsException`, with the transport's or decoder's error as its `cause`: `Permanent` is a client error, a body that cannot be read, or a local response-size limit, and another attempt would get the same one; `Transient` is everything else, a TLS failure included, and leaves the next attempt to the application's queue. TLS failures are not retried inside the client, but a captive portal or a wrong clock can clear later. The default transport is `HttpURLConnection`, each attempt bounded at 300 seconds, with 15-second connect/read idle limits and an 8 MiB body cap. Requests use eight workers with no queue; disconnect helpers have a separate two-worker pool with at most eight pending disconnects; request saturation fails transiently; unlike Swift's session it does not wait for connectivity, so an offline device fails as `Transient` after its retries, quickly when lookups fail at once, after the 15-second idle limits on silent connections, or at the whole-attempt bound for a trickling response. The transport requests identity encoding to preserve framing headers on Android, and responses over the body cap fail permanently without retries. Pass another `IwlsTransport` to use a different HTTP stack. A request can take far longer than a WorkManager worker's 10-minute run: four attempts bounded at 300 seconds, or a 600-second `Retry-After`. Run a download as a long-running foreground worker, or fetch one chunk per work request so a stopped worker loses only that chunk. The module is tested on the JVM; as with the engine, execution on an Android device is pending. Queueing, persistence and fitting belong to the application. Pass `IwlsSampleGrid(ChsTideFit.SAMPLE_MINUTES)` or `IwlsSampleGrid(ChsCurrentFit.SAMPLE_MINUTES)` to `series`; supported steps are 1, 3, 5, 15, and 60 minutes, with 15 as the default. `IwlsChunkCacheEntry.create` validates full-week endpoints and grid identity. Its `isReusable` policy keeps complete weeks indefinitely and expires successfully empty weeks after 24 hours. A different grid or truncated week must be fetched again. The client fetches for the user's own device and does not authorize redistributing CHS predictions.

## Subordinates and datums

```kotlin
val subordinateTide = SubordinateTideStation(
    tide, highTimeOffsetSeconds = 120.0, lowTimeOffsetSeconds = -60.0,
    height = HeightOffset.Ratio(high = 1.1, low = 0.9)
)
// Or HeightOffset.Fixed(high = 0.2, low = -0.1), in metres.
val subordinateCurrent = SubordinateCurrentStation(
    current, slackBeforeFloodOffsetSeconds = 60.0, slackBeforeEbbOffsetSeconds = -60.0,
    floodTimeOffsetSeconds = 120.0, ebbTimeOffsetSeconds = -120.0,
    floodSpeedRatio = 1.1, ebbSpeedRatio = 0.9
)
```

The harmonic sum is relative to mean sea level; `Station.offsetMetres` adds a caller-resolved datum offset. Ratio tide reductions require the reference in chart datum. Apply any final chart-to-requested-datum difference after reduction. Ratios must be nonnegative; fixed corrections can be negative. All subordinate time offsets are seconds (convert database/NOAA minutes before construction).

Subordinate curves interpolate corrected events with a half cosine. Short requests expand their event context until corrected knots bracket both timeline boundaries, with the longest active constituent period bounding that expansion. An oscillating reference that still cannot supply surrounding knots causes an explicit error. Empty event tables from non-oscillating references retain the zero curve. These curves approximate the official event table rather than reconstruct local hydraulics. Corrected events are sorted; coincident knots use the last value. Current slack offsets follow the next maximum's phase, using an adaptive search up to the longest active constituent period when a short request lacks that maximum. A required phase that still cannot be resolved causes an explicit error; standalone table reduction retains the flood fallback. Current slacks are exactly zero after reduction.

Current events use independent whole-UTC-day searches, then crop to the exact requested bounds. TypeScript returns the covering UTC days instead, so its parity fixture can extend beyond its nominal end. Tide harmonic extrema use an outward 600-second search grid, matching Swift; subordinate tide events crop after corrections.

## Develop and verify

From `kotlin/` with JDK 17:

```sh
./gradlew test jacocoTestReport jacocoTestCoverageVerification
./gradlew -p smoke run
```

JaCoCo enforces 100% handwritten line coverage, excluding only generated `CatalogDataKt`. Reports are in `build/reports/`. Tests read shared checked-in fixtures without network access: timelines within `1e-6` metres/knots, event count/kind exact and event differences below 60 seconds and 0.02 metres/knots. NOAA accuracy gates are in [the engine contract](../docs/CONTRACT.md).

From the repository root, `npm run fixtures:check` checks both generated catalogs and the shared oracle vectors. To regenerate the catalogs intentionally, run `node fixtures/generate/gen-catalog.mjs`. Keep generated Swift and Kotlin outputs together with their source changes. Existing fixture values must never be loosened to fit a port.

The engine is [MIT licensed](../LICENSE). Read the repository's [navigation warning](../README.md) before using predictions.
