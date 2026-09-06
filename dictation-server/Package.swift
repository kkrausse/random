// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dictation-server",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "dictation-server", targets: ["DictationServer"])],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.5"),
        .package(url: "https://github.com/vapor/vapor.git", exact: "4.110.1"),
    ],
    targets: [
        .target(name: "DictationCore", dependencies: [
            .product(name: "FluidAudio", package: "FluidAudio"),
            .product(name: "Vapor", package: "vapor"),
        ]),
        .executableTarget(name: "DictationServer", dependencies: ["DictationCore", .product(name: "Vapor", package: "vapor")]),
        .testTarget(name: "DictationServerTests", dependencies: ["DictationCore"]),
    ],
    swiftLanguageModes: [.v5]
)
