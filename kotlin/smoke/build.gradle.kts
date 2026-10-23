import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.4.21"
    application
}
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
    implementation("io.openwaters:slackwater-engine:0.1.0")
    implementation("io.openwaters:slackwater-iwls:0.1.0")
}
application { mainClass = "SmokeKt" }
