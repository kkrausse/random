import CryptoKit
import Foundation
import Photos
import SwiftUI

struct PhotoResourceDescriptor: Equatable, Sendable {
    let role: String
    let filename: String
    let uniformTypeIdentifier: String
}

struct PhotoAlbum: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let count: Int
    let isSmartAlbum: Bool
}

enum PhotoResourceSelector {
    static func includes(type: PHAssetResourceType) -> Bool {
        switch type {
        case .photo, .video, .audio, .pairedVideo, .alternatePhoto: true
        default: false
        }
    }

    static func descriptors(for resources: [PHAssetResource]) -> [PhotoResourceDescriptor] {
        resources.filter { includes(type: $0.type) }.map {
            PhotoResourceDescriptor(role: role(for: $0.type), filename: $0.originalFilename, uniformTypeIdentifier: $0.uniformTypeIdentifier)
        }
    }

    static func role(for type: PHAssetResourceType) -> String {
        switch type {
        case .photo: "photo"
        case .video: "video"
        case .audio: "audio"
        case .pairedVideo: "pairedVideo"
        case .alternatePhoto: "alternatePhoto"
        default: "excluded"
        }
    }
}

struct PhotoLibraryService {
    func requestAuthorization() async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else { throw PicSyncError.photosPermission }
    }

    func asset(for localIdentifier: String) throws -> PHAsset {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
        guard let asset = result.firstObject else {
            AppLog.write("[Photos] asset identifier no longer resolves identifier=\(localIdentifier)")
            throw PicSyncError.photoAssetUnavailable
        }
        return asset
    }

    func albums() throws -> [PhotoAlbum] {
        let user = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        let smart = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .any, options: nil)
        return collections(from: user, isSmartAlbum: false) + collections(from: smart, isSmartAlbum: true)
    }

    func assetIdentifiers(forAlbumID id: String) throws -> [String] {
        let collections = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil)
        guard let collection = collections.firstObject else { throw PicSyncError.sourceUnavailable }
        let assets = PHAsset.fetchAssets(in: collection, options: nil)
        var identifiers = [String]()
        assets.enumerateObjects { asset, _, _ in identifiers.append(asset.localIdentifier) }
        return identifiers
    }

    private func collections(from result: PHFetchResult<PHAssetCollection>, isSmartAlbum: Bool) -> [PhotoAlbum] {
        var albums = [PhotoAlbum]()
        result.enumerateObjects { collection, _, _ in
            let count = PHAsset.fetchAssets(in: collection, options: nil).count
            if count > 0 { albums.append(PhotoAlbum(id: collection.localIdentifier, title: collection.localizedTitle ?? "Untitled Album", count: count, isSmartAlbum: isSmartAlbum)) }
        }
        return albums.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}

struct PhotoResourceExporter {
    private let manager = PHAssetResourceManager.default()

    func stage(asset: PHAsset, runID: UUID, transferID: UUID) async throws -> [ResourceManifest] {
        let resources = PHAssetResource.assetResources(for: asset).filter { PhotoResourceSelector.includes(type: $0.type) }
        guard !resources.isEmpty else { throw PicSyncError.sourceUnavailable }
        let directory = try stagingDirectory(runID: runID, transferID: transferID)
        var manifests = [ResourceManifest]()
        do {
            for (index, resource) in resources.enumerated() {
                try Task.checkCancellation()
                let role = PhotoResourceSelector.role(for: resource.type)
                let ext = URL(fileURLWithPath: resource.originalFilename).pathExtension
                let fallback = "\(asset.creationDate.map { Self.fallbackDate.string(from: $0) } ?? "asset")_\(String(asset.localIdentifier.prefix(8)))_\(role)\(ext.isEmpty ? "" : ".\(ext)")"
                let filename = SafeFilename.make(resource.originalFilename, fallback: fallback)
                let localURL = directory.appendingPathComponent("\(index)-\(UUID().uuidString).\(URL(fileURLWithPath: filename).pathExtension)")
                let temporaryURL = localURL.appendingPathExtension("partial")
                try await export(resource, to: temporaryURL)
                try FileManager.default.moveItem(at: temporaryURL, to: localURL)
                let hash = try ContentHasher.hash(file: localURL)
                let size = try localURL.resourceValues(forKeys: [.fileSizeKey]).fileSize.map(Int64.init) ?? 0
                manifests.append(ResourceManifest(role: role, filename: filename, stagingPath: localURL.path, byteCount: size, sha256: hash, finalPath: nil, temporaryPath: nil))
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
        return manifests
    }

    private func export(_ resource: PHAssetResource, to url: URL) async throws {
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            manager.writeData(for: resource, toFile: url, options: options) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func stagingDirectory(runID: UUID, transferID: UUID) throws -> URL {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Transfers", isDirectory: true)
            .appendingPathComponent(runID.uuidString, isDirectory: true)
            .appendingPathComponent(transferID.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private static let fallbackDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter
    }()
}

enum ContentHasher {
    static func hash(file url: URL, chunkSize: Int = 1_048_576) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: chunkSize) ?? Data()
            guard !data.isEmpty else { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func assetFingerprint(_ resources: [ResourceManifest]) -> String {
        let canonical = resources.sorted { $0.role == $1.role ? $0.sha256 < $1.sha256 : $0.role < $1.role }
            .map { "\($0.role)|\($0.byteCount)|\($0.sha256)" }.joined(separator: "\n")
        return SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
