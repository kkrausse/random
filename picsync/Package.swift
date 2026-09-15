// swift-tools-version: 5.10
import PackageDescription

// Core validation on macOS, independent of device signing and the iOS UI target.
let package = Package(
    name: "PicSyncCore",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "vendor/SMBClient")],
    targets: [
        .target(name: "picsync", dependencies: [.product(name: "SMBClient", package: "SMBClient")], path: "picsync", exclude: ["ContentView.swift", "picsyncApp.swift", "Assets.xcassets", "Preview Content"]),
        .testTarget(name: "picsyncTests", dependencies: ["picsync"], path: "picsyncTests")
    ]
)
