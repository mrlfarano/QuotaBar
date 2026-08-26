// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "barstats",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "barstats",
            path: "Sources/barstats"
        )
    ]
)
