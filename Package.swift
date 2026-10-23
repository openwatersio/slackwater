// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "slackwater",
    platforms: [.macOS(.v13), .iOS(.v16), .watchOS(.v9)],
    products: [
        .library(name: "SlackwaterKit", targets: ["SlackwaterKit"]),
        .library(name: "SlackwaterIWLS", targets: ["SlackwaterIWLS"])
    ],
    targets: [
        .target(
            name: "SlackwaterIWLS",
            path: "swift/Sources/SlackwaterIWLS",
            exclude: ["LICENSE", "README.md"]
        ),
        .testTarget(
            name: "SlackwaterIWLSTests",
            dependencies: ["SlackwaterIWLS"],
            path: "swift/Tests/SlackwaterIWLSTests"
        ),
        .target(
            name: "SlackwaterKit",
            path: "swift/Sources/SlackwaterKit",
            resources: [.process("Resources/catalog.json")]
        ),
        .testTarget(
            name: "SlackwaterKitTests",
            dependencies: ["SlackwaterKit"],
            path: "swift/Tests/SlackwaterKitTests"
        )
    ]
)
