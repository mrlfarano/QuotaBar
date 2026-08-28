// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "quotabar",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "quotabar",
            path: "Sources/quotabar"
        ),
        .testTarget(
            name: "quotabarTests",
            dependencies: ["quotabar"],
            path: "Tests/quotabarTests"
        )
    ]
)
