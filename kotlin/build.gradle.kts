import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.4.21"
    jacoco
}

group = "io.openwaters"
version = "0.1.0"
repositories { mavenCentral() }
kotlin {
    jvmToolchain(17)
    compilerOptions { jvmTarget = JvmTarget.JVM_1_8 }
}
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}
dependencies {
    testImplementation(kotlin("test-junit5"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
}
tasks.test {
    useJUnitPlatform()
    systemProperty("fixtures", layout.projectDirectory.dir("../fixtures").asFile.absolutePath)
}
jacoco { toolVersion = "0.8.13" }
tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports { xml.required = true; html.required = true }
    classDirectories.setFrom(sourceSets.main.get().output.asFileTree.matching {
        exclude("io/openwaters/slackwater/CatalogDataKt.class")
    })
}
tasks.jacocoTestCoverageVerification {
    dependsOn(tasks.test)
    classDirectories.setFrom(tasks.jacocoTestReport.get().classDirectories)
    violationRules {
        rule { limit { counter = "LINE"; minimum = "1.0".toBigDecimal() } }
    }
}
