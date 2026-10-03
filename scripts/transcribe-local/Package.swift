// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TranscribeLocal",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(path: "../../../dictate-wrapper/vendor/FluidAudio")
    ],
    targets: [
        .executableTarget(
            name: "transcribe-local",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ]
        )
    ]
)
